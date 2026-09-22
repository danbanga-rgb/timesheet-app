import { UploadCloud } from 'lucide-react';

export default function QbAutomationV2() {
  return (
    <div className="bg-white rounded-lg shadow-md p-8">
      <div className="max-w-xl mx-auto text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-indigo-50 mb-4">
          <UploadCloud className="w-7 h-7 text-indigo-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">QB Automation v2</h2>
        <p className="text-gray-600 mb-6">
          Rebuilt QB push interface — admin preview. Accountant continues to use the v1 QB Automation tab.
        </p>
        <p className="text-xs text-gray-400">Slice V2 — skeleton shipped.</p>
      </div>
    </div>
  );
}
