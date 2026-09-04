// Contract Admin landing dashboard. Minimal for now — welcome + Chat entry.
// Per project_chat_bot memory, CA's primary surface IS chat; this landing
// page is what they see if they open the main app URL rather than /chat.

import { MessageSquare, LogOut } from 'lucide-react';
import { supabase } from '../../supabaseClient';

export default function ContractAdminDashboard({ userName }: { userName: string }) {
  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Contract Admin</h1>
              <p className="text-gray-600">Welcome, {userName}</p>
              <p className="text-sm text-indigo-600 font-medium">Role: Contracts</p>
            </div>
            <button
              onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Open the chat assistant</h2>
          <p className="text-sm text-gray-600 mb-4">
            Add new users, set start / end dates, look up profiles, or list users matching filters — all from a single chat surface.
          </p>
          <a
            href="/chat"
            className="inline-flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-base font-medium"
          >
            <MessageSquare className="w-5 h-5" /> Open Synergie Chat
          </a>
          <p className="text-xs text-gray-400 mt-4">
            Try: <span className="font-mono">who has no start date?</span>, <span className="font-mono">add Sarah Chen sarah@example.com US APFM</span>, or <span className="font-mono">Harun ends today</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
