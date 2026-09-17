import { FileText, UploadCloud, X } from 'lucide-react';

interface FileUploadCardProps {
  file: File | null;
  onFileChange: (f: File | null) => void;
  accept: string;
  helpText: string;
}

export function FileUploadCard({ file, onFileChange, accept, helpText }: FileUploadCardProps) {
  return (
    <div className="border-2 border-dashed border-indigo-300 rounded-lg p-6 text-center mb-4">
      {file ? (
        <div className="flex items-center justify-center gap-2 text-indigo-700">
          <FileText className="w-5 h-5" />
          <span className="text-sm font-medium">{file.name}</span>
          <button onClick={() => onFileChange(null)} className="text-gray-400 hover:text-red-500 ml-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <label className="cursor-pointer">
          <UploadCloud className="w-10 h-10 text-indigo-300 mx-auto mb-2" />
          <p className="text-sm text-gray-600">{helpText}</p>
          <input
            type="file"
            accept={accept}
            className="hidden"
            onChange={e => onFileChange(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
    </div>
  );
}
