import { useState } from 'react';
import { Save } from 'lucide-react';
import { supabase } from '../../supabaseClient';

interface PasswordResetFormProps {
  onDone: () => void;
}

export default function PasswordResetForm({ onDone }: PasswordResetFormProps) {
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSetNewPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      alert('Password must be at least 6 characters'); return;
    }
    if (newPassword !== newPasswordConfirm) {
      alert('Passwords do not match'); return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) { alert('Error setting password: ' + error.message); return; }
    setNewPassword('');
    setNewPasswordConfirm('');
    alert('Password updated successfully! You can now log in.');
    await supabase.auth.signOut();
    onDone();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Save className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Set New Password</h1>
          <p className="text-gray-600 mt-2">Choose a new password for your account</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="Min. 6 characters"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
            <input
              type="password"
              value={newPasswordConfirm}
              onChange={e => setNewPasswordConfirm(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleSetNewPassword()}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="Re-enter password"
            />
          </div>
          {newPassword && newPasswordConfirm && newPassword !== newPasswordConfirm && (
            <p className="text-sm text-red-600">Passwords do not match</p>
          )}
          <button
            onClick={handleSetNewPassword}
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Set Password & Log In'}
          </button>
        </div>
      </div>
    </div>
  );
}
