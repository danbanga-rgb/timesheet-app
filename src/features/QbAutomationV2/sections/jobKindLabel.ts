// Plain-English names for qb_sync_jobs.kind. Shared by the pending-jobs
// popup and the failed-push popover on Ready rows.
const JOB_KIND_LABELS: Record<string, string> = {
  bill_query: 'Refresh bills',
  vendor_query: 'Refresh vendors',
  account_query: 'Refresh accounts',
  bill_add: 'Create Bill',
  bill_pmt_add: 'Pay Bill',
  check_add: 'Write Check',
  vendor_add: 'Add Vendor',
};

export function jobKindLabel(kind: string): string {
  return JOB_KIND_LABELS[kind] || kind;
}
