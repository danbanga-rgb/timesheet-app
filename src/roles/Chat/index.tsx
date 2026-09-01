// Chat surface entry point. Routes to LoginScreen / NotAllowedScreen /
// ChatShell based on auth state + chat_enabled flag.
//
// MVP (Slice 2a): uses main-app Supabase session. Passkey (Slice 2b) will
// swap the auth path but keep this shell.

import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { getChatProfile, signOutChat, type ChatProfile } from './api';
import ChatShell from './ChatShell';

type State =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'not_allowed'; profile: ChatProfile }
  | { kind: 'ready'; profile: ChatProfile };

export default function ChatApp() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const profile = await getChatProfile();
      if (!mounted) return;
      if (!profile) return setState({ kind: 'unauthenticated' });
      if (!profile.chat_enabled) return setState({ kind: 'not_allowed', profile });
      setState({ kind: 'ready', profile });
    })();
    return () => { mounted = false; };
  }, []);

  if (state.kind === 'loading') return <FullPage>Loading…</FullPage>;
  if (state.kind === 'unauthenticated') return <LoginScreen />;
  if (state.kind === 'not_allowed') return <NotAllowedScreen profile={state.profile} />;
  return <ChatShell profile={state.profile} />;
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) setError(error.message);
    else window.location.reload();  // let ChatApp re-check profile + chat_enabled
  }

  async function handleMagicLink() {
    if (!email) {
      setError('Enter your email first, then click Magic Link.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/chat` },
    });
    setSubmitting(false);
    if (error) setError(error.message);
    else setMagicLinkSent(true);
  }

  return (
    <FullPage>
      <div className="max-w-sm w-full bg-white rounded-xl shadow-md p-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Synergie Chat</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in to continue.</p>
        {magicLinkSent ? (
          <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
            Magic link sent to <strong>{email}</strong>. Check your inbox.
          </div>
        ) : (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            {error && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
            )}
            <input
              type="email"
              required
              placeholder="you@synergietechsolutions.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:bg-gray-300"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="text-center">
              <button
                type="button"
                onClick={handleMagicLink}
                disabled={submitting}
                className="text-xs text-gray-500 hover:text-indigo-600 underline"
              >
                Forgot password? Send magic link instead
              </button>
            </div>
          </form>
        )}
      </div>
    </FullPage>
  );
}

function NotAllowedScreen({ profile }: { profile: ChatProfile }) {
  return (
    <FullPage>
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8 text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Chat not enabled</h1>
        <p className="text-sm text-gray-600 mb-4">
          Signed in as <strong>{profile.email}</strong>, but this account isn't chat-enabled.
        </p>
        <p className="text-xs text-gray-500 mb-6">
          Contact your administrator to request access.
        </p>
        <button
          onClick={signOutChat}
          className="text-sm text-indigo-600 hover:text-indigo-800 underline"
        >
          Sign out
        </button>
      </div>
    </FullPage>
  );
}

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      {children}
    </div>
  );
}
