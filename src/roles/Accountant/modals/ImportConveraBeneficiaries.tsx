import { Clock, UploadCloud, X } from 'lucide-react';
import { FileUploadCard } from '../../../components/FileUploadCard';
import type { PaymentProfile, ConveraBeneficiary, UserProfile } from '../../../types';

interface UnmatchedRow {
  profileId: number;
  userId: string;
  userName: string;
  suggested?: {
    beneficiaryId: number;
    level: 'iban' | 'name';
    shortName: string;
    incomingVendorId: string | null;
  };
}

interface ImportConveraBeneficiariesProps {
  open: boolean;
  onClose: () => void;
  file: File | null;
  onFileChange: (f: File | null) => void;
  importing: boolean;
  result: { imported: number; matched: number; unmatched: UnmatchedRow[] } | null;
  paymentProfiles: PaymentProfile[];
  users: UserProfile[];
  converaBeneficiaries: ConveraBeneficiary[];
  beneficiaryOverrideProfileId: number | null;
  setBeneficiaryOverrideProfileId: (id: number | null) => void;
  beneficiaryOverrideSearch: string;
  setBeneficiaryOverrideSearch: (s: string) => void;
  setConveraOverride: (profileId: number, beneficiaryId: number | null) => void;
  computeSynVendorCode: (profileId: number, iban: string, allProfiles: { id: number; iban: string }[]) => string;
  onImport: (file: File) => void;
}

export default function ImportConveraBeneficiaries({
  open,
  onClose,
  file,
  onFileChange,
  importing,
  result,
  paymentProfiles,
  users,
  converaBeneficiaries,
  beneficiaryOverrideProfileId,
  setBeneficiaryOverrideProfileId,
  beneficiaryOverrideSearch,
  setBeneficiaryOverrideSearch,
  setConveraOverride,
  computeSynVendorCode,
  onImport,
}: ImportConveraBeneficiariesProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Import Beneficiaries</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <div>
            {(() => {
              const awaiting = paymentProfiles.filter(p => {
                if (p.converaBeneficiaryId) return false;
                if (!p.country || p.country.trim().toUpperCase() === 'US' || p.country.trim().toLowerCase() === 'united states') return false;
                const owner = users.find(u => u.id === p.userId);
                if (owner?.locationType === 'onshore') return false;
                return !!(p.iban && p.swift);
              });
              if (awaiting.length === 0) return null;
              const synFor = (p: PaymentProfile) => computeSynVendorCode(p.id, p.iban, paymentProfiles);
              return (
                <div className="mb-5 border border-amber-300 rounded-lg overflow-hidden">
                  <div className="bg-amber-50 px-4 py-2 border-b border-amber-200 text-xs font-semibold text-amber-800 flex items-center justify-between">
                    <span>⏳ Awaiting Convera setup — {awaiting.length} profile{awaiting.length === 1 ? '' : 's'}</span>
                    <span className="text-[10px] text-amber-600 font-normal">Add these in Convera with the SYN vendor code shown, then re-import to link.</span>
                  </div>
                  <div className="divide-y divide-amber-100">
                    {awaiting.map(p => {
                      const owner = users.find(u => u.id === p.userId);
                      const synCode = synFor(p);
                      const detailLines = [
                        `Vendor ID: ${synCode}`,
                        `Full Company Name: ${p.companyName}`,
                        p.companyAddress && `Company Address: ${p.companyAddress}`,
                        p.country && `Country: ${p.country}`,
                        p.bankName && `Bank Name: ${p.bankName}`,
                        p.bankAddress && `Bank Address: ${p.bankAddress}`,
                        p.bankBranch && `Bank Branch: ${p.bankBranch}`,
                        p.accountNumber && `Account Number: ${p.accountNumber}`,
                        `IBAN: ${p.iban}`,
                        `SWIFT: ${p.swift}`,
                        p.paymentEmail && `Payment Email: ${p.paymentEmail}`,
                      ].filter(Boolean).join('\n');
                      return (
                        <div key={p.id} className="p-3 bg-white">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-800">{owner?.name || '—'}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{p.companyName}</div>
                              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] font-mono text-gray-600">
                                <span><span className="text-amber-700 font-semibold">{synCode}</span></span>
                                <span>IBAN {p.iban}</span>
                                <span>SWIFT {p.swift}</span>
                                {p.country && <span>{p.country}</span>}
                              </div>
                            </div>
                            <button
                              onClick={async () => {
                                try { await navigator.clipboard.writeText(detailLines); } catch { /* clipboard may fail in insecure contexts */ }
                              }}
                              className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 whitespace-nowrap"
                            >Copy details</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            <p className="text-sm text-gray-600 mb-1">Upload the Convera beneficiaries XLS export. Beneficiaries will be upserted and automatically matched to contractor payment profiles by Vendor ID (SYN code), IBAN, or name prefix.</p>
            <p className="text-xs text-gray-400 mb-4">In Convera: Beneficiaries &rarr; Export. Re-import anytime to refresh.</p>
            <FileUploadCard
              file={file}
              accept=".xls,.tsv,.txt,.csv"
              helpText="Click to select beneficiaries XLS"
              onFileChange={onFileChange}
            />
            {result && (
              <div className="mb-4">
                <div className="flex gap-4 mb-3">
                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded text-sm font-medium">{result.imported} imported</span>
                  <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded text-sm font-medium">{result.matched} profiles matched</span>
                  {result.unmatched.length > 0 && (
                    <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded text-sm font-medium">{result.unmatched.length} unmatched</span>
                  )}
                </div>
                {result.unmatched.length > 0 && (
                  <div className="border border-amber-200 rounded-lg divide-y divide-amber-100">
                    {result.unmatched.map(u => (
                      <div key={u.profileId} className="bg-amber-50">
                        <div className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm text-gray-700">{u.userName}</div>
                            {u.suggested && (
                              <div className="mt-0.5 text-xs text-amber-800">
                                Suggested ({u.suggested.level === 'iban' ? 'IBAN match' : 'name match'}):
                                <span className="ml-1 font-mono">{u.suggested.shortName}</span>
                                {u.suggested.incomingVendorId && <span className="ml-1 text-amber-600">· vendor {u.suggested.incomingVendorId}</span>}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {u.suggested && beneficiaryOverrideProfileId !== u.profileId && (
                              <button onClick={() => setConveraOverride(u.profileId, u.suggested!.beneficiaryId)} className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 font-medium">Confirm link</button>
                            )}
                            {beneficiaryOverrideProfileId === u.profileId
                              ? <button onClick={() => { setBeneficiaryOverrideProfileId(null); setBeneficiaryOverrideSearch(''); }} className="text-xs text-gray-500 hover:underline">Cancel</button>
                              : <button onClick={() => { setBeneficiaryOverrideProfileId(u.profileId); setBeneficiaryOverrideSearch(''); }} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700">{u.suggested ? 'Pick different…' : 'Link manually'}</button>
                            }
                          </div>
                        </div>
                        {beneficiaryOverrideProfileId === u.profileId && (
                          <div className="px-3 pb-3 border-t border-amber-200 bg-indigo-50">
                            <input
                              type="text" value={beneficiaryOverrideSearch}
                              onChange={e => setBeneficiaryOverrideSearch(e.target.value)}
                              placeholder="Search Convera beneficiary…" autoFocus
                              className="w-full mt-2 px-3 py-1.5 border border-indigo-200 rounded text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                            <div className="max-h-36 overflow-y-auto divide-y divide-indigo-100 rounded border border-indigo-100">
                              {converaBeneficiaries
                                .filter(b => beneficiaryOverrideSearch === '' || b.shortName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase()) || b.beneficiaryName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase()))
                                .slice(0, 20)
                                .map(b => (
                                  <button key={b.id} onClick={() => setConveraOverride(u.profileId, b.id)}
                                    className="w-full text-left px-2 py-1.5 hover:bg-indigo-100 text-sm bg-white">
                                    <span className="font-mono text-xs text-indigo-600 mr-2">{b.shortName}</span>
                                    <span className="text-gray-400 text-xs">{b.bankAccount}</span>
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => file && onImport(file)}
                disabled={!file || importing}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
              >
                {importing ? <><Clock className="w-4 h-4 animate-spin" /> Importing&hellip;</> : <><UploadCloud className="w-4 h-4" /> Import &amp; Match</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
