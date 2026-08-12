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
  buildBillAddRq,
  buildBillPaymentCheckAddRq,
  buildBillQueryRq,
} from './qbxml/builders.ts';
import {
  parseBillAddRs,
  parseBillPaymentCheckAddRs,
  parseBillQueryRs,
  unwrapQbxmlResponses,
} from './qbxml/parsers.ts';
import type {
  BillAddRqInput,
  BillPaymentCheckAddRqInput,
  BillQueryRqInput,
} from './qbxml/types.ts';
import {
  buildSoapFault,
  buildSoapResponse,
  parseSoapRequest,
  xmlEscape,
} from './soap.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobRow {
  id: number;
  kind: 'bill_query' | 'bill_add' | 'bill_pmt_add';
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
    default:
      throw new Error(`Unknown job kind: ${(job as JobRow).kind}`);
  }
  return wrapQbxmlRequests([element]);
}

/** Parse a qbXML response envelope and persist the result to the appropriate
 *  domain table. Returns { ok, errorMsg } for job status accounting. */
async function persistJobResponse(
  job: JobRow,
  responseXml: string,
  supabase: ReturnType<typeof makeSupabase>,
): Promise<{ ok: boolean; errorMsg: string | null }> {
  const fragments = unwrapQbxmlResponses(responseXml);
  const first = fragments[0] ?? responseXml;

  if (job.kind === 'bill_query') {
    const parsed = parseBillQueryRs(first);
    if (parsed.status.statusCode !== '0' && parsed.results.length === 0) {
      return { ok: false, errorMsg: `BillQuery status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    // Persist TxnID by RefNumber → invoices.qb_bill_txn_id
    for (const r of parsed.results) {
      await supabase
        .from('invoices')
        .update({ qb_bill_txn_id: r.txnId })
        .eq('invoice_number', r.refNumber);
    }
    return { ok: true, errorMsg: null };
  }

  if (job.kind === 'bill_add') {
    const parsed = parseBillAddRs(first);
    if (!parsed.result) {
      return { ok: false, errorMsg: `BillAdd status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    // Persist TxnID by refNumber → invoices.qb_bill_txn_id
    await supabase
      .from('invoices')
      .update({ qb_bill_txn_id: parsed.result.txnId })
      .eq('invoice_number', parsed.result.refNumber);
    return { ok: true, errorMsg: null };
  }

  if (job.kind === 'bill_pmt_add') {
    const parsed = parseBillPaymentCheckAddRs(first);
    if (!parsed.result) {
      return { ok: false, errorMsg: `BillPaymentCheckAdd status=${parsed.status.statusCode}: ${parsed.status.statusMessage}` };
    }
    // Persist to convera_transactions.qb_billpmt_txn_id by payload's confirmation_number
    const conf = (job.payload as { confirmationNumber?: string }).confirmationNumber;
    if (conf) {
      await supabase
        .from('convera_transactions')
        .update({ qb_billpmt_txn_id: parsed.result.txnId })
        .eq('confirmation_number', conf);
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

/** Count of jobs done vs total for the current WC session — used to feed the
 *  int return of receiveResponseXML (0..100 percent complete). We scope by
 *  "jobs older than the session started_at that weren't already done at
 *  session start". Simpler heuristic for MVP: total pending+in_flight+done
 *  where started_at >= session.started_at. */
async function sessionProgress(
  supabase: ReturnType<typeof makeSupabase>,
  sessionStartedAt: string,
): Promise<number> {
  const { data } = await supabase
    .from('qb_sync_jobs')
    .select('status')
    .gte('started_at', sessionStartedAt);
  const rows = (data || []) as Array<{ status: string }>;
  if (rows.length === 0) return 100;
  const done = rows.filter(r => r.status === 'done' || r.status === 'error' || r.status === 'skipped').length;
  return Math.min(100, Math.round((done / rows.length) * 100));
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
