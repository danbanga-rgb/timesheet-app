// Contract Admin view — top-level entry rendered from TimesheetSystem
// when currentUser.role === 'contract_admin'.
//
// Modular per [[modularization-backlog]]: all Contract Admin UI lives under
// this directory. TimesheetSystem imports ContractAdminView and mounts it
// instead of inlining role UI.

import { LogOut } from 'lucide-react';
import NewContractForm from './NewContractForm';

interface Props {
  userName: string;
  onLogout: () => void;
}

export default function ContractAdminView({ userName, onLogout }: Props) {
  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Contracts</h1>
              <p className="text-gray-600">Welcome, {userName}</p>
              <p className="text-sm text-indigo-600 font-medium">Role: Contract Admin</p>
            </div>
            <button onClick={onLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </div>

        <NewContractForm />
      </div>
    </div>
  );
}
