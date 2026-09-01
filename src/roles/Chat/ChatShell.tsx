// Chat conversation shell — thread + input. Slice 3 (real UI + LLM parse)
// builds on top of this; Slice 2a ships the container with a placeholder.

import { signOutChat, type ChatProfile } from './api';

export default function ChatShell({ profile }: { profile: ChatProfile }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Synergie Chat</h1>
          <p className="text-xs text-gray-500">
            {profile.name} · {profile.role}
          </p>
        </div>
        <button
          onClick={signOutChat}
          className="text-xs text-gray-500 hover:text-gray-800 underline"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center text-gray-400">
          <p className="text-sm">Chat surface active. Message thread + input arriving in Slice 3.</p>
          <p className="text-xs mt-2">You're signed in as {profile.email} with chat_enabled=true.</p>
        </div>
      </main>
    </div>
  );
}
