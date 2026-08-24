// Supabase Edge Function: qb-web-connector
//
// SOAP endpoint spoken to by Intuit's QuickBooks Web Connector (QBWC), which
// runs on the accountant's Windows machine and shuttles qbXML requests to a
// live QB Desktop 2020 Pro instance. Full architecture in project memory
// [[qb-web-connector-design]].
//
// QBWC calls this endpoint via 8 SOAP methods (per Intuit's QBWebConnectorSvc
// WSDL). We handle each and coordinate a job queue in qb_sync_jobs. Session
// lifecycle in qb_wc_sessions.
//
// Auth: shared secret from env (QB_WC_USER, QB_WC_PASS). Single accountant
// use case — no per-user isolation needed.
//
// Deploy: `supabase functions deploy qb-web-connector --no-verify-jwt`
//         (JWT off — QBWC is not a Supabase client and doesn't send JWTs.)
//
// See also:
//   - qbxml/ — local copy of src/lib/qbxml/ (builders + parsers + types).
//   - src/lib/qbxml/GOTCHAS.md — Chunks 2-3 decisions and Aug 9 open questions.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { wrapQbxmlRequests } from './qbxml/envelope.ts';
import {
  buildAccountQueryRq,
  buildBillAddRq,
  buildBillPaymentCheckAddRq,
  buildBillQueryRq,
  buildCheckAddRq,
  buildVendorQueryRq,
} from './qbxml/builders.ts';
import {
  parseAccountQueryRs,
  parseBillAddRs,
  parseBillPaymentCheckAddRs,
  parseBillPaymentCheckQueryRs,
  parseBillQueryRs,
  parseCheckAddRs,
  parseVendorQueryRs,
  unwrapQbxmlResponses,
} from './qbxml/parsers.ts';
import type {
  AccountQueryRqInput,
  BillAddRqInput,
  BillPaymentCheckAddRqInput,
  BillQueryRqInput,
  CheckAddRqInput,
  VendorQueryRqInput,
} from './qbxml/types.ts';
import { validatePayload } from './qbxml/job-payloads.ts';
import {
  buildSoapFault,
  buildSoapResponse,
  parseSoapRequest,
  xmlEscape,
} from './soap.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobRow {
  id: number;
  kind: 'bill_query' | 'bill_add' | 'bill_pmt_add' | 'check_add' | 'account_query' | 'vendor_query';
  payload: Record<string, unknown>;
  depends_on: number[] | null;
  status: 'pending' | 'in_flight' | 'done' | 'error' | 'skipped';
  qbxml_request: string | null;
  qbxml_response: string | null;
  error_msg: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVER_VERSION = '0.1.0';
const CONTENT_TYPE_SOAP = 'text/xml; charset=utf-8';

// ─── Env-scoped credentials ───────────────────────────────────────────────────

function getExpectedCreds(): { user: string; pass: string } {
  const user = Deno.env.get('QB_WC_USER') || '';
  const pass = Deno.env.get('QB_WC_PASS') || '';
  return { user, pass };
}

// ─── Supabase client (service role, DB writes) ────────────────────────────────

function makeSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  );
}

// ─── Job dispatch ─────────────────────────────────────────────────────────────

/** Fetch the oldest pending job whose depends_on jobs are ALL status='done'. */
async function nextRunnableJob(supabase: ReturnType<typeof makeSupabase>): Promise<JobRow | null> {
  const { data: pending } = await supabase
    .from('qb_sync_jobs')
    .select('id, kind, payload, depends_on, status, qbxml_request, qbxml_response, error_msg')
    .eq('status', 'pending')
    .order('id', { ascending: true })
    .limit(50);  // small batch — deps evaluated in-process, dispatch one
  const rows = (pending || []) as JobRow[];
  if (rows.length === 0) return null;
  // Gather all depends_on ids across the batch and fetch their statuses
  const allDeps = new Set<number>();
  for (const r of rows) for (const d of (r.depends_on || [])) allDeps.add(d);
  let depStatus = new Map<number, string>();
  if (allDeps.size > 0) {
    const { data: deps } = await supabase
      .from('qb_sync_jobs')
      .select('id, status')
      .in('id', Array.from(allDeps));
    depStatus = new Map((deps || []).map((d: any) => [d.id as number, d.status as string]));
  }
  for (const r of rows) {
    const deps = r.depends_on || [];
    if (deps.every(id => depStatus.get(id) === 'done')) return r;
  }
  return null;
}

/** Render a job's payload into a qbXML request envelope. */
function renderJobRequest(job: JobRow): string {
  const requestId = String(job.id);
  let element: string;
  switch (job.kind) {
    case 'bill_query':
      element = buildBillQueryRq({ ...(job.payload as BillQueryRqInput), requestId });
      break;
    case 'bill_add':
      element = buildBillAddRq({ ...(job.payload as BillAddRqInput), requestId });
      break;
    case 'bill_pmt_add':
      element = buildBillPaymentCheckAddRq({ ...(job.payload as BillPaymentCheckAddRqInput), requestId });
      break;
    case 'check_add':
      element = buildCheckAddRq({ ...(job.payload as CheckAddRqInput), requestId });
      break;
    case 'account_query':
      element = buildAccountQueryRq({ ...(job.payload as AccountQueryRqInput), requestId });
      break;
    case 'vendor_query':
      element = buildVendorQueryRq({ ...(job.payload as VendorQueryRqInput), requestId });
      break;
    case 'bill_pmt_query': {
      // Exploratory read-only query. Payload provides pre-built XML; we splice
      // in the requestID and pass through. No structured builder yet — this
      // kind exists for one-off discovery of historic payment patterns.
      const raw = (job.payload as { rawQbxmlRequest: string }).rawQbxmlRequest;
      element = raw.replace(/<BillPaymentCheckQueryRq(\s|>)/, `<BillPaymentCheckQueryRq requestID="${requestId}"$1`);
      break;
    }
    default:
      throw new Error(`Unknown job kind: ${(job as JobRow).kind}`);
  }
  return wrapQbxmlRequests([element]);
}

/** Classify a parsed query response's status.
 *
 *  QB WC convention for query-shape responses (BillQueryRs, AccountQueryRs,
 *  VendorQueryRs, BillPaymentCheckQueryRs):
 *   - statusCode="0"                       → success, N results
 *   - statusCode="500" statusSeverity="Warn" + zero results
 *                                          → success, no match (legitimate answer)
 *   - anything else                        → real error
 *
 *  Prior code treated any non-zero code with empty results as an error, which
 *  polluted the log with "Object cannot be found in QuickBooks" false alarms
 *  (Aug 17 jobs 233/234/235 during Intuit Phase 1a discovery).
 */
function isQueryStatusOk(
  status: { statusCode: string; statusSeverity: string; statusMessage: string },
  resultsLen: number,
): boolean {
  if (status.statusCode === '0') return true;
  if (status.statusCode === '500' && status.statusSeverity === 'Warn' && resultsLen === 0) return true;
  return false;
}

/** Parse a qbXML response envelope and persist the result to the appropriate
 *  domain table. Returns { ok, errorMsg } for job status accounting. */
async function persistJobResponse(
  job: JobRow,
  responseXml: string,
  supabase: ReturnType<typeof makeSupabase>,
): Promise<{ ok: boolean; errorMsg: string | null }> {
  // Fail-fast payload contract check. If enqueue script drift removed a key
  // this branch depends on, catch here with a specific "missing X" error
  // instead of silently no-op'ing downstream. Kinds with no required keys
  // (account_query, vendor_query) pass through cleanly.
  const pv = validatePayload(job.kind, job.payload);
  if (!pv.ok) {
    return { ok: false, errorMsg: `Payload contract violation on ${job.kind}: missing required key(s) [${pv.missing.join(', ')}]. Check the enqueue script for drift from src/lib/qbxml/job-payloads.ts.` };
  }

  const fragments = unwrapQbxmlResponses(responseXml);
  const first = fragments[0] ?? responseXml;

  if (job.kind === 'bill_query') {
    const parsed = parseBillQueryRs(first);
    if (!isQueryStatusOk(parsed.status, parsed.results.length)) {
      return { ok: false, errorMsg: `BillQuery status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    // No matches — the query legitimately answered "not found". Persist step is a no-op.
    if (parsed.results.length === 0) {
      return { ok: true, errorMsg: null };
    }
    // Persist TxnID → invoices.qb_bill_txn_id.
    //   All persist paths must key on (vendor, refNumber) — never refNumber alone —
    //   because Croatian contractors routinely share invoice numbers ("INV 7-1-1",
    //   "INV 04/26", "INV 20260701"). Vendor-blind updates cross-pollute TxnIDs
    //   between contractors. Discovered 2026-08-13 on batch 15 for payments; found
    //   again 2026-08-14 in this same persist path for bills.
    //
    //   MULTI-YYYY-MM RefNumber: no invoice literally matches that number; the bill
    //   covers every invoice for that vendor whose period_end falls in that month.
    //   Fan out via payment_profiles.qb_vendor_name → user_id.
    //   Direct RefNumber: matches invoice_number 1:1 for that vendor's invoices only.
    //
    //   Mode-aware tolerance:
    //     Targeted mode (payload supplied txnIds[] or refNumbers[]) — every returned
    //       BillRet is expected to map to something in our DB. Unmatched vendor or
    //       0-row-update = drift; fail-fast so a human notices.
    //     Iterator mode (entityVendorName + date range, no txnIds/refNumbers) —
    //       the query is enumerating ALL bills for a vendor, including historic
    //       pre-our-system bills that WON'T be linkable. Skip those silently,
    //       opportunistically persist matches, summarise counters at the end.
    //       (Root-caused 2026-08-19 on audit jobs 326-329: iterator returned 6
    //       BillRets per vendor, the first was always a pre-our-system historic
    //       invoice, and the loop errored on row 1 before reaching the newer
    //       bills we actually wanted to reconcile.)
    const payload = job.payload as BillQueryRqInput;
    const isIteratorMode = !payload.txnIds?.length && !payload.refNumbers?.length;
    // Verify-chain jobs (bill_query enqueued as a post-push verify by intuitPush
    // et al.) carry __verify_for_event_id. Their purpose is mirror refresh so
    // the status pane can see is_settled flip — NOT invoice-linkage persist.
    // For G7b orphan events (TechAntz) the invoice-side is empty by design;
    // hard-failing on "no payment_profile matches" would break every verify
    // for orphan-created bills. Skip invoice-linkage errors in verify mode;
    // mirror upsert (below) is what matters.
    const isVerifyJob = (job.payload as { __verify_for_event_id?: number }).__verify_for_event_id != null;
    const tolerateInvoicePersistMiss = isIteratorMode || isVerifyJob;
    let linked = 0;
    let skippedUnmappedVendor = 0;
    let skippedUnknownInvoice = 0;
    const errors: string[] = [];
    for (const r of parsed.results) {
      if (!r.vendorFullName) {
        // Without vendor we can't disambiguate. Even in iterator mode this is
        // structurally wrong (VendorRef.FullName is always present in a BillRet)
        // and worth surfacing.
        errors.push(`missing VendorRef.FullName for refNumber=${r.refNumber}`);
        continue;
      }
      const { data: pps } = await supabase
        .from('payment_profiles')
        .select('user_id')
        .eq('qb_vendor_name', r.vendorFullName);
      const userIds = [...new Set((pps ?? []).map((p: { user_id: string }) => p.user_id))];
      if (userIds.length === 0) {
        if (tolerateInvoicePersistMiss) { skippedUnmappedVendor++; continue; }
        return { ok: false, errorMsg: `BillQuery persist: no payment_profile.qb_vendor_name matches "${r.vendorFullName}" (refNumber=${r.refNumber})` };
      }
      const multi = /^MULTI-(\d{4})-(\d{2})$/.exec(r.refNumber);
      let update = supabase
        .from('invoices')
        .update({ qb_bill_txn_id: r.txnId })
        .in('user_id', userIds);
      if (multi) {
        const [, y, m] = multi;
        const first = `${y}-${m}-01`;
        const last  = new Date(Number(y), Number(m), 0).toISOString().slice(0, 10);
        update = update.gte('period_end', first).lte('period_end', last);
      } else {
        update = update.eq('invoice_number', r.refNumber);
      }
      const { data: updated, error: updErr } = await update.select('id');
      if (updErr) {
        return { ok: false, errorMsg: `BillQuery persist DB error for vendor="${r.vendorFullName}" refNumber="${r.refNumber}": ${updErr.message}` };
      }
      if (!updated || updated.length === 0) {
        if (tolerateInvoicePersistMiss) { skippedUnknownInvoice++; continue; }
        return { ok: false, errorMsg: `BillQuery persist: 0 rows updated for vendor="${r.vendorFullName}" refNumber="${r.refNumber}". Invoice(s) may have been deleted/renumbered after enqueue.` };
      }
      linked += updated.length;
    }
    if (errors.length > 0) {
      // Structural issues (missing VendorRef) — surface even in iterator mode.
      return { ok: false, errorMsg: `BillQuery persist structural errors: ${errors.join('; ')}` };
    }
    if (isIteratorMode) {
      console.log(`[bill_query iterator job=${job.id} vendor="${payload.entityVendorName}"] results=${parsed.results.length} linked=${linked} skipped_unmapped_vendor=${skippedUnmappedVendor} skipped_unknown_invoice=${skippedUnknownInvoice}`);
    }

    // Slice G1.1: unified qb_mirror (entity_kind='bill'). Runs alongside the
    // invoice-linkage above (Convera-critical, preserved). Skips rows missing
    // OpenAmount/IsPaid — older QB responses may omit them and we shouldn't
    // record a false "settled/unsettled" state.
    const mirrorRows = parsed.results
      .filter(r => r.vendorListId && r.vendorFullName && r.amount != null && r.openAmount != null && r.isPaid != null)
      .map(r => ({
        entity_kind: 'bill' as const,
        entity_ref:  r.txnId,
        vendor_list_id: r.vendorListId!,
        ref_number:  r.refNumber,
        amount:      r.amount!,
        is_settled:  r.isPaid!,
        data: {
          vendor_name:   r.vendorFullName!,
          open_amount:   r.openAmount!,
          txn_date:      r.txnDate ?? null,
          due_date:      r.dueDate ?? null,
          time_modified: r.timeModified ?? null,
        },
        queried_at: new Date().toISOString(),
      }));
    if (mirrorRows.length > 0) {
      const { error: snapErr } = await supabase
        .from('qb_mirror')
        .upsert(mirrorRows, { onConflict: 'entity_kind,entity_ref' });
      if (snapErr) {
        // Do NOT fail the job on mirror upsert failure — the invoice-linkage
        // (Convera-critical) already succeeded above. Log for investigation.
        console.warn(`[bill_query job=${job.id}] qb_mirror upsert failed:`, snapErr.message);
      } else {
        console.log(`[bill_query job=${job.id}] qb_mirror upserted ${mirrorRows.length} rows (kind=bill)`);
      }
    } else if (parsed.results.length > 0) {
      console.log(`[bill_query job=${job.id}] qb_mirror skipped — no BillRets had complete open-amount/is-paid fields`);
    }

    return { ok: true, errorMsg: null };
  }

  if (job.kind === 'bill_add') {
    const parsed = parseBillAddRs(first);
    if (!parsed.result) {
      return { ok: false, errorMsg: `BillAdd status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    const payload = job.payload as { vendorName?: string; sourceIngestEventId?: number; sourceInvoiceIds?: number[] };
    const vendorName = payload.vendorName;
    if (!vendorName) {
      return { ok: false, errorMsg: `BillAdd payload missing vendorName; cannot safely persist TxnID for refNumber=${parsed.result.refNumber}` };
    }
    // Orphan-create path (G7b): bill_add was triggered by a qb_ingest_event
    // with no matching invoice in our system. Persist the new bill TxnID onto
    // the event row so the follow-up pay step and reconciler can find it.
    // Also seed qb_mirror so reconciler treats the new bill as authoritative.
    if (payload.sourceIngestEventId != null && (!payload.sourceInvoiceIds || payload.sourceInvoiceIds.length === 0)) {
      const { error: evErr } = await supabase
        .from('qb_ingest_events')
        .update({ resolved_bill_txn_id: parsed.result.txnId })
        .eq('id', payload.sourceIngestEventId);
      if (evErr) {
        return { ok: false, errorMsg: `BillAdd orphan persist DB error for event=${payload.sourceIngestEventId} vendor="${vendorName}" refNumber="${parsed.result.refNumber}": ${evErr.message}` };
      }
      // Seed mirror row so next reconciler pass sees the bill (avoids a round
      // trip through bill_query). Full hydration happens on the next scheduled
      // bill_query anyway. amount/is_settled from payload — bill is definitely
      // unpaid at creation.
      const totalAmount = ((payload as unknown) as { lines?: Array<{ amount: number }> }).lines
        ?.reduce((n, l) => n + Number(l.amount ?? 0), 0) ?? 0;
      const { data: vendorRow } = await supabase.from('qb_vendors').select('list_id').eq('name', vendorName).limit(1).maybeSingle();
      if (vendorRow?.list_id) {
        await supabase.from('qb_mirror').upsert({
          entity_kind: 'bill',
          entity_ref: parsed.result.txnId,
          vendor_list_id: vendorRow.list_id,
          ref_number: parsed.result.refNumber,
          amount: totalAmount,
          is_settled: false,
          data: {
            vendor_name: vendorName,
            txn_date: (payload as unknown as { txnDate?: string }).txnDate ?? null,
            due_date: (payload as unknown as { dueDate?: string }).dueDate ?? null,
          },
          queried_at: new Date().toISOString(),
        }, { onConflict: 'entity_kind,entity_ref' });
      }
      return { ok: true, errorMsg: null };
    }
    // Invoice-linked path (original): persist onto invoices matching (vendor, refNumber).
    const { data: pps } = await supabase
      .from('payment_profiles')
      .select('user_id')
      .eq('qb_vendor_name', vendorName);
    const userIds = [...new Set((pps ?? []).map((p: { user_id: string }) => p.user_id))];
    if (userIds.length === 0) {
      // Bill successfully created in QB but our DB has no mapping for the vendor —
      // silent orphan. Fail-fast: the QB bill exists (with TxnID `parsed.result.txnId`)
      // but we can't attribute it. Human must add the mapping and manually re-link.
      return { ok: false, errorMsg: `BillAdd persist: no payment_profile.qb_vendor_name matches "${vendorName}". QB bill created (TxnID=${parsed.result.txnId}) but not linked to any invoice.` };
    }
    const { data: updated, error: updErr } = await supabase
      .from('invoices')
      .update({ qb_bill_txn_id: parsed.result.txnId, qb_export_status: 'exported' })
      .in('user_id', userIds)
      .eq('invoice_number', parsed.result.refNumber)
      .select('id');
    if (updErr) {
      return { ok: false, errorMsg: `BillAdd persist DB error for vendor="${vendorName}" refNumber="${parsed.result.refNumber}": ${updErr.message}` };
    }
    if (!updated || updated.length === 0) {
      return { ok: false, errorMsg: `BillAdd persist: 0 rows updated for vendor="${vendorName}" refNumber="${parsed.result.refNumber}". QB bill was created (TxnID=${parsed.result.txnId}) but our invoice can't be found — was it renumbered or deleted after enqueue?` };
    }
    return { ok: true, errorMsg: null };
  }

  if (job.kind === 'account_query') {
    const parsed = parseAccountQueryRs(first);
    if (!isQueryStatusOk(parsed.status, parsed.accounts.length)) {
      return { ok: false, errorMsg: `AccountQuery status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    // Slice G1.1: upsert into unified qb_mirror (entity_kind='account'). Legacy
    // qb_accounts VIEW still queryable by all consumers (frontend loader, etc).
    if (parsed.accounts.length > 0) {
      const rows = parsed.accounts.map(a => ({
        entity_kind: 'account' as const,
        entity_ref:  a.listId,
        is_active:   a.isActive,
        data: {
          full_name:        a.fullName,
          account_type:     a.accountType,
          name:             a.name,             // preserved for future consumers
          parent_full_name: a.parentFullName,   // preserved for future consumers
        },
        queried_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('qb_mirror').upsert(rows, { onConflict: 'entity_kind,entity_ref' });
      if (error) {
        return { ok: false, errorMsg: `AccountQuery qb_mirror upsert failed: ${error.message}` };
      }
      console.log(`[account_query job=${job.id}] qb_mirror upserted ${rows.length} rows (kind=account)`);
    }
    return { ok: true, errorMsg: null };
  }

  if (job.kind === 'vendor_query') {
    const parsed = parseVendorQueryRs(first);
    if (!isQueryStatusOk(parsed.status, parsed.vendors.length)) {
      return { ok: false, errorMsg: `VendorQuery status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    // Slice G1.1: upsert into unified qb_mirror (entity_kind='vendor'). Legacy
    // qb_vendors VIEW still queryable — used by Convera qb-batch-dryrun.cjs,
    // frontend Slice D mapping widget, and edge fn cross-refs.
    if (parsed.vendors.length > 0) {
      const rows = parsed.vendors.map(v => ({
        entity_kind: 'vendor' as const,
        entity_ref:  v.listId,
        is_active:   v.isActive,
        data: {
          name:         v.name,
          ...(v.companyName ? { company_name: v.companyName } : {}),
        },
        queried_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('qb_mirror').upsert(rows, { onConflict: 'entity_kind,entity_ref' });
      if (error) {
        return { ok: false, errorMsg: `VendorQuery qb_mirror upsert failed: ${error.message}` };
      }
      console.log(`[vendor_query job=${job.id}] qb_mirror upserted ${rows.length} rows (kind=vendor)`);
    }
    return { ok: true, errorMsg: null };
  }

  if (job.kind === 'bill_pmt_add') {
    const parsed = parseBillPaymentCheckAddRs(first);
    if (!parsed.result) {
      return { ok: false, errorMsg: `BillPaymentCheckAdd status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    const payload = job.payload as {
      sourceConveraTxnId?: number;
      sourceIngestEventId?: number;
      payeeVendorName?: string;
      applications?: { paymentAmount?: number }[];
    };
    // Convera path — umbrella-safe: a single Convera wire can span multiple vendors
    // (BIMOSOFT, Native Teams, Teal) → multiple bill_pmt_add jobs share the same
    // sourceConveraTxnId but produce distinct QB payment TxnIDs. Prior code wrote
    // each to convera_transactions.qb_billpmt_txn_id (last-wins, silently lost the
    // other N-1). We now insert per-(wire, vendor) into convera_transaction_billpmts
    // and keep the old column populated as a "at least one recorded" cache.
    if (payload.sourceConveraTxnId != null) {
      if (!payload.payeeVendorName) {
        return { ok: false, errorMsg: `BillPaymentCheckAdd persist: payload missing payeeVendorName. QB payment created (TxnID=${parsed.result.txnId}) for wire ${payload.sourceConveraTxnId} but vendor unknown — link table row cannot be built.` };
      }
      const paymentAmount = (payload.applications ?? []).reduce((s, a) => s + (Number(a.paymentAmount) || 0), 0);
      const { error: linkErr } = await supabase
        .from('convera_transaction_billpmts')
        .upsert({
          convera_transaction_id: payload.sourceConveraTxnId,
          qb_vendor_name:         payload.payeeVendorName,
          qb_billpmt_txn_id:      parsed.result.txnId,
          payment_amount:         paymentAmount,
        }, { onConflict: 'convera_transaction_id,qb_vendor_name' });
      if (linkErr) {
        return { ok: false, errorMsg: `BillPaymentCheckAdd persist DB error inserting link row for wire=${payload.sourceConveraTxnId} vendor="${payload.payeeVendorName}": ${linkErr.message}` };
      }
      // Legacy single-value cache. Deliberately last-write-wins — we don't check for
      // an existing value; the link table is authoritative for per-vendor lookups.
      // This column is a "was ever paid" bit for legacy consumers (matcher_ignore
      // filter, older UI badges). Drop candidate for a future migration.
      const { error: cacheErr } = await supabase
        .from('convera_transactions')
        .update({ qb_billpmt_txn_id: parsed.result.txnId })
        .eq('id', payload.sourceConveraTxnId);
      if (cacheErr) {
        console.warn(`BillPaymentCheckAdd: link row saved but legacy cache update failed for wire=${payload.sourceConveraTxnId}: ${cacheErr.message}`);
      }
      return { ok: true, errorMsg: null };
    }
    // Intuit path (G7a, 2026-08-21) — persist writes the returned TxnID back
    // to qb_ingest_events.posted_qb_refs.bill_pmt + flips status to 'posted' +
    // appends this job id. Mirrors the check_add persist pattern below.
    // INVARIANTS #18: without status='posted', a re-Push would create a duplicate.
    if (payload.sourceIngestEventId != null) {
      const { data: existing, error: readErr } = await supabase
        .from('qb_ingest_events')
        .select('posted_qb_refs, qb_sync_job_ids')
        .eq('id', payload.sourceIngestEventId)
        .maybeSingle();
      if (readErr) {
        return { ok: false, errorMsg: `BillPaymentCheckAdd persist (Intuit) DB read error for event ${payload.sourceIngestEventId}: ${readErr.message}. QB payment created (TxnID=${parsed.result.txnId}) but event row not updated — re-push would duplicate.` };
      }
      const existingRefs = (existing as { posted_qb_refs?: Record<string, unknown> } | null)?.posted_qb_refs ?? {};
      const existingJobIds = (existing as { qb_sync_job_ids?: number[] } | null)?.qb_sync_job_ids ?? [];
      const nextRefs = { ...existingRefs, bill_pmt: parsed.result.txnId, posted_source: 'push' };
      const nextJobIds = existingJobIds.includes(job.id) ? existingJobIds : [...existingJobIds, job.id];
      const { error: updErr } = await supabase
        .from('qb_ingest_events')
        .update({
          status: 'posted',
          status_updated_at: new Date().toISOString(),
          posted_qb_refs: nextRefs,
          qb_sync_job_ids: nextJobIds,
        })
        .eq('id', payload.sourceIngestEventId);
      if (updErr) {
        return { ok: false, errorMsg: `BillPaymentCheckAdd persist (Intuit) DB update error for event ${payload.sourceIngestEventId}: ${updErr.message}. QB payment created (TxnID=${parsed.result.txnId}) but event row not marked posted — re-push would duplicate.` };
      }
      return { ok: true, errorMsg: null };
    }
    return { ok: false, errorMsg: `BillPaymentCheckAdd persist: payload has neither sourceConveraTxnId nor sourceIngestEventId. QB payment created (TxnID=${parsed.result.txnId}) but no domain row linked.` };
  }

  if (job.kind === 'check_add') {
    // Slice E of QB Automation Layer. Direct-expense check written on behalf
    // of a qb_ingest_events row. Persist writes the returned TxnID back to
    // qb_ingest_events.posted_qb_refs.check + flips status to 'posted' + adds
    // this job's id to qb_sync_job_ids.
    const parsed = parseCheckAddRs(first);
    if (!parsed.result) {
      return { ok: false, errorMsg: `CheckAdd status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    const payload = job.payload as { sourceIngestEventId?: number };
    if (payload.sourceIngestEventId == null) {
      return { ok: false, errorMsg: `CheckAdd persist: payload missing sourceIngestEventId. QB check created (TxnID=${parsed.result.txnId}) but not linked to any qb_ingest_events row.` };
    }
    // Merge into posted_qb_refs jsonb + append this job id + flip status.
    const { data: existing, error: readErr } = await supabase
      .from('qb_ingest_events')
      .select('posted_qb_refs, qb_sync_job_ids')
      .eq('id', payload.sourceIngestEventId)
      .maybeSingle();
    if (readErr) {
      return { ok: false, errorMsg: `CheckAdd persist DB read error for event ${payload.sourceIngestEventId}: ${readErr.message}` };
    }
    const existingRefs = (existing as { posted_qb_refs?: Record<string, unknown> } | null)?.posted_qb_refs ?? {};
    const existingJobIds = (existing as { qb_sync_job_ids?: number[] } | null)?.qb_sync_job_ids ?? [];
    const nextRefs = { ...existingRefs, check: parsed.result.txnId };
    const nextJobIds = existingJobIds.includes(job.id) ? existingJobIds : [...existingJobIds, job.id];
    const { error: updErr } = await supabase
      .from('qb_ingest_events')
      .update({
        status: 'posted',
        status_updated_at: new Date().toISOString(),
        posted_qb_refs: nextRefs,
        qb_sync_job_ids: nextJobIds,
      })
      .eq('id', payload.sourceIngestEventId);
    if (updErr) {
      return { ok: false, errorMsg: `CheckAdd persist DB update error for event ${payload.sourceIngestEventId}: ${updErr.message}` };
    }
    return { ok: true, errorMsg: null };
  }

  if (job.kind === 'bill_pmt_query') {
    // Slice G2: parse BillPaymentCheckQueryRs, upsert each payment into qb_mirror
    // (entity_kind='bill_payment'). Skips rows missing required identity fields.
    // AppliedToTxnRet (which bills a payment settled) is only present if the
    // request set IncludeLineItems=true; captured in data.applied_to_bills for
    // the reconciler.
    const parsed = parseBillPaymentCheckQueryRs(first);
    if (!isQueryStatusOk(parsed.status, parsed.results.length)) {
      return { ok: false, errorMsg: `BillPaymentCheckQuery status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    if (parsed.results.length === 0) return { ok: true, errorMsg: null };
    const mirrorRows = parsed.results
      .filter(r => r.payeeEntityListId && r.amount != null)
      .map(r => ({
        entity_kind: 'bill_payment' as const,
        entity_ref:  r.txnId,
        vendor_list_id: r.payeeEntityListId!,
        ref_number:  r.refNumber ?? null,
        amount:      r.amount!,
        is_settled:  null,  // not meaningful for payments (bills carry that flag)
        data: {
          vendor_name: r.payeeEntityFullName ?? null,
          txn_date: r.txnDate ?? null,
          bank_list_id: r.bankAccountListId ?? null,
          bank_full_name: r.bankAccountFullName ?? null,
          memo: r.memo ?? null,
          time_modified: r.timeModified ?? null,
          applied_to_bills: r.appliedToBills,  // may be empty when IncludeLineItems=false
        },
        queried_at: new Date().toISOString(),
      }));
    if (mirrorRows.length > 0) {
      const { error } = await supabase.from('qb_mirror').upsert(mirrorRows, { onConflict: 'entity_kind,entity_ref' });
      if (error) {
        return { ok: false, errorMsg: `BillPaymentCheckQuery qb_mirror upsert failed: ${error.message}` };
      }
      console.log(`[bill_pmt_query job=${job.id}] qb_mirror upserted ${mirrorRows.length} rows (kind=bill_payment)`);
    } else if (parsed.results.length > 0) {
      console.log(`[bill_pmt_query job=${job.id}] qb_mirror skipped — no BillPaymentCheckRets had required identity fields`);
    }
    return { ok: true, errorMsg: null };
  }

  return { ok: false, errorMsg: `Unknown job kind on response: ${job.kind}` };
}

// ─── Ticket validation ───────────────────────────────────────────────────────
// Guards handlers other than serverVersion/clientVersion/authenticate: only
// tickets issued by a prior successful authenticate() are allowed. Prevents
// arbitrary POSTs from dispatching real qb_sync_jobs or leaking session state.

async function validateTicket(
  ticket: string | undefined,
  supabase: ReturnType<typeof makeSupabase>,
): Promise<boolean> {
  if (!ticket) return false;
  const { data } = await supabase
    .from('qb_wc_sessions')
    .select('ticket')
    .eq('ticket', ticket)
    .maybeSingle();
  return !!data;
}

// ─── Session progress ─────────────────────────────────────────────────────────

/** Return value for receiveResponseXML — governs whether WC continues the
 *  session (< 100 = more work; WC calls sendRequestXML again) or ends it
 *  (>= 100 = done; WC calls closeConnection).
 *
 *  Prior implementation counted only jobs already dispatched THIS session
 *  (started_at >= sessionStart). After the first job completed, denominator
 *  and numerator matched (1/1) → returned 100 → WC closed after one job.
 *  This bit us on batch 15 (2026-08-13): 29 queries queued, only 1 ran per
 *  session, throughput reduced to one-job-per-15-min-poll instead of drain-
 *  in-one-session.
 *
 *  New behavior: peek at the queue. If another runnable job exists, return a
 *  progress signal < 100 so WC keeps the session alive. When nothing runnable
 *  remains, return 100 to close cleanly. Progress denominator = done +
 *  remaining, so the number climbs toward 100 as we drain. */
async function sessionProgress(
  supabase: ReturnType<typeof makeSupabase>,
  sessionStartedAt: string,
): Promise<number> {
  const { data: sessionRows } = await supabase
    .from('qb_sync_jobs')
    .select('status')
    .gte('started_at', sessionStartedAt);
  const rows = (sessionRows || []) as Array<{ status: string }>;
  const done = rows.filter(r => r.status === 'done' || r.status === 'error' || r.status === 'skipped').length;

  // Is there ANY runnable job still pending? nextRunnableJob checks deps.
  const nextJob = await nextRunnableJob(supabase);
  if (!nextJob) {
    // No more work — close the session cleanly.
    return 100;
  }
  // More work waiting — keep session alive. Report progress as if the next
  // job is one of N remaining, so the number climbs monotonically.
  const denom = done + 1;
  const pct = Math.round((done / denom) * 100);
  // Clamp to 99 to guarantee WC calls sendRequestXML again (100 = close).
  return Math.min(99, Math.max(0, pct));
}

// ─── SOAP handlers ────────────────────────────────────────────────────────────

async function handleServerVersion(): Promise<string> {
  return buildSoapResponse('serverVersion', xmlEscape(SERVER_VERSION));
}

async function handleClientVersion(_params: Record<string, string>): Promise<string> {
  // Empty response = accept any WC version. Prefix with "W:" for a warning
  // (WC displays), "E:" for an error (WC aborts).
  return buildSoapResponse('clientVersion', '');
}

async function handleAuthenticate(params: Record<string, string>): Promise<string> {
  const { user, pass } = getExpectedCreds();
  const supabase = makeSupabase();
  const gotUser = params.strUserName || '';
  const gotPass = params.strPassword || '';
  if (!user || !pass) {
    // No creds configured — reject with an explicit error string
    return buildSoapResponse('authenticate', '<string></string><string>nvu</string>');
  }
  if (gotUser !== user || gotPass !== pass) {
    return buildSoapResponse('authenticate', '<string></string><string>nvu</string>');
  }
  // Generate ticket, persist session
  const ticket = crypto.randomUUID();
  await supabase.from('qb_wc_sessions').insert({
    ticket,
    started_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    qb_company: null,
  });
  // Check for pending work up-front — if none, return "none" so WC exits cleanly
  const job = await nextRunnableJob(supabase);
  const companyFile = job ? '' : 'none';
  return buildSoapResponse('authenticate',
    `<string>${xmlEscape(ticket)}</string><string>${companyFile}</string>`);
}

async function handleSendRequestXML(params: Record<string, string>): Promise<string> {
  const ticket = params.ticket || '';
  const supabase = makeSupabase();
  if (!await validateTicket(ticket, supabase)) {
    return buildSoapResponse('sendRequestXML', '');
  }
  // Touch session
  await supabase.from('qb_wc_sessions').update({ last_seen_at: new Date().toISOString() }).eq('ticket', ticket);

  const job = await nextRunnableJob(supabase);
  if (!job) {
    // Empty string tells WC we're out of work — end the session
    return buildSoapResponse('sendRequestXML', '');
  }
  let requestXml: string;
  try {
    requestXml = renderJobRequest(job);
  } catch (e) {
    await supabase.from('qb_sync_jobs').update({
      status: 'error',
      error_msg: `render failure: ${String(e)}`,
      completed_at: new Date().toISOString(),
    }).eq('id', job.id);
    // Send empty and let WC end the session; we'll retry via a new WC run
    return buildSoapResponse('sendRequestXML', '');
  }
  await supabase.from('qb_sync_jobs').update({
    status: 'in_flight',
    started_at: new Date().toISOString(),
    qbxml_request: requestXml,
  }).eq('id', job.id);
  await supabase.from('qb_wc_sessions').update({ job_id: job.id }).eq('ticket', ticket);

  return buildSoapResponse('sendRequestXML', xmlEscape(requestXml));
}

async function handleReceiveResponseXML(params: Record<string, string>): Promise<string> {
  const ticket = params.ticket || '';
  const responseXml = params.response || '';
  const hresult = params.hresult || '';
  const message = params.message || '';
  const supabase = makeSupabase();
  if (!await validateTicket(ticket, supabase)) {
    return buildSoapResponse('receiveResponseXML', '-1');
  }
  await supabase.from('qb_wc_sessions').update({ last_seen_at: new Date().toISOString() }).eq('ticket', ticket);

  const { data: sess } = await supabase
    .from('qb_wc_sessions')
    .select('job_id, started_at')
    .eq('ticket', ticket)
    .maybeSingle();
  const jobId = (sess?.job_id as number | null) ?? null;
  const sessStarted = (sess?.started_at as string | null) ?? new Date(0).toISOString();

  if (jobId != null) {
    const { data: jobRow } = await supabase
      .from('qb_sync_jobs')
      .select('id, kind, payload, depends_on, status, qbxml_request, qbxml_response, error_msg')
      .eq('id', jobId)
      .maybeSingle();
    if (jobRow) {
      const job = jobRow as unknown as JobRow;
      // If WC reported hresult != 0, mark as error without parsing
      if (hresult && hresult !== '0' && hresult !== '0x0') {
        await supabase.from('qb_sync_jobs').update({
          status: 'error',
          qbxml_response: responseXml,
          error_msg: `WC hresult=${hresult}: ${message}`,
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      } else {
        const { ok, errorMsg } = await persistJobResponse(job, responseXml, supabase);
        await supabase.from('qb_sync_jobs').update({
          status: ok ? 'done' : 'error',
          qbxml_response: responseXml,
          error_msg: errorMsg,
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
    }
    await supabase.from('qb_wc_sessions').update({ job_id: null }).eq('ticket', ticket);
  }

  const pct = await sessionProgress(supabase, sessStarted);
  // Positive int = percent done; negative = error requiring WC to stop
  return buildSoapResponse('receiveResponseXML', String(pct));
}

async function handleCloseConnection(params: Record<string, string>): Promise<string> {
  const ticket = params.ticket || '';
  const supabase = makeSupabase();
  if (!await validateTicket(ticket, supabase)) {
    return buildSoapResponse('closeConnection', 'OK');
  }
  await supabase.from('qb_wc_sessions').update({ last_seen_at: new Date().toISOString() }).eq('ticket', ticket);
  return buildSoapResponse('closeConnection', 'OK');
}

async function handleConnectionError(params: Record<string, string>): Promise<string> {
  const ticket = params.ticket || '';
  const supabase = makeSupabase();
  if (await validateTicket(ticket, supabase)) {
    await supabase.from('qb_wc_sessions').update({ last_seen_at: new Date().toISOString() }).eq('ticket', ticket);
  }
  // "done" tells WC to give up trying another company file
  return buildSoapResponse('connectionError', 'done');
}

async function handleGetLastError(params: Record<string, string>): Promise<string> {
  const ticket = params.ticket || '';
  const supabase = makeSupabase();
  if (!await validateTicket(ticket, supabase)) {
    return buildSoapResponse('getLastError', '');
  }
  const { data: sess } = await supabase
    .from('qb_wc_sessions')
    .select('job_id')
    .eq('ticket', ticket)
    .maybeSingle();
  const jobId = (sess?.job_id as number | null) ?? null;
  let msg = '';
  if (jobId != null) {
    const { data: j } = await supabase
      .from('qb_sync_jobs')
      .select('error_msg')
      .eq('id', jobId)
      .maybeSingle();
    msg = (j?.error_msg as string | null) ?? '';
  }
  return buildSoapResponse('getLastError', xmlEscape(msg));
}

// ─── HTTP request routing ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  const url = new URL(req.url);

  // GET /qwc — download-the-.qwc-file helper (accountant setup)
  // Returns a stable .qwc XML file. UUIDs are hardcoded on purpose: re-downloads
  // must produce the SAME file so Web Connector recognises it as an existing
  // app rather than a duplicate. AppURL is derived from this request's host so
  // the same code works across dev + prod deploys.
  if (req.method === 'GET' && url.pathname.endsWith('/qwc')) {
    const wcUser = Deno.env.get('QB_WC_USER') || '';
    // Build AppURL from SUPABASE_URL rather than the request URL. The request
    // arrives with a stripped path (Supabase's edge router rewrites) and http
    // scheme (Cloudflare terminates TLS upstream), both wrong for the .qwc file.
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
    const appUrl = `${supabaseUrl}/functions/v1/qb-web-connector`;
    // QBWC1000: Web Connector requires AppURL and AppSupport to share a domain.
    // Point AppSupport at the same edge fn URL — health probe response is JSON but
    // functionally the "get help" link opens a valid endpoint, and the domain matches.
    const appSupport = appUrl;
    const qwc = `<?xml version="1.0"?>
<QBWCXML>
  <AppName>Synergie Timesheet App</AppName>
  <AppID>{14a3de1c-b2e0-4048-9e8c-87924a13fa4c}</AppID>
  <AppURL>${xmlEscape(appUrl)}</AppURL>
  <AppDescription>Sync bills and payments from the Synergie timesheet system into QuickBooks Desktop.</AppDescription>
  <AppSupport>${xmlEscape(appSupport)}</AppSupport>
  <UserName>${xmlEscape(wcUser)}</UserName>
  <OwnerID>{f354b289-aa7f-454a-a2ea-3680b800347b}</OwnerID>
  <FileID>{652f2b08-9806-4a8f-a056-bfdf01bf7421}</FileID>
  <QBType>QBFS</QBType>
  <Scheduler>
    <RunEveryNMinutes>15</RunEveryNMinutes>
  </Scheduler>
</QBWCXML>
`;
    return new Response(qwc, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.intuit.QBWebConnector',
        'content-disposition': 'attachment; filename="synergie-timesheet.qwc"',
        // Allow the frontend admin tab to fetch this from the browser.
        'access-control-allow-origin': '*',
      },
    });
  }

  // GET / — health probe
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({ ok: true, server: 'qb-web-connector', version: SERVER_VERSION }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const body = await req.text();
  const parsed = parseSoapRequest(body);
  if (!parsed) {
    return new Response(buildSoapFault('Malformed SOAP envelope'), {
      status: 500,
      headers: { 'content-type': CONTENT_TYPE_SOAP },
    });
  }

  try {
    let responseXml: string;
    switch (parsed.method) {
      case 'serverVersion':      responseXml = await handleServerVersion(); break;
      case 'clientVersion':      responseXml = await handleClientVersion(parsed.params); break;
      case 'authenticate':       responseXml = await handleAuthenticate(parsed.params); break;
      case 'sendRequestXML':     responseXml = await handleSendRequestXML(parsed.params); break;
      case 'receiveResponseXML': responseXml = await handleReceiveResponseXML(parsed.params); break;
      case 'closeConnection':    responseXml = await handleCloseConnection(parsed.params); break;
      case 'connectionError':    responseXml = await handleConnectionError(parsed.params); break;
      case 'getLastError':       responseXml = await handleGetLastError(parsed.params); break;
      default:
        return new Response(buildSoapFault(`Unknown SOAP method: ${parsed.method}`), {
          status: 500,
          headers: { 'content-type': CONTENT_TYPE_SOAP },
        });
    }
    return new Response(responseXml, {
      status: 200,
      headers: { 'content-type': CONTENT_TYPE_SOAP },
    });
  } catch (e) {
    console.error(`qb-web-connector handler error for ${parsed.method}:`, e);
    return new Response(buildSoapFault(`Handler error: ${String(e)}`), {
      status: 500,
      headers: { 'content-type': CONTENT_TYPE_SOAP },
    });
  }
});
