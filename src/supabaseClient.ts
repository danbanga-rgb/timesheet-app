import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Stable per-tab key stored in sessionStorage so it survives refreshes
// but is never shared across windows. Prevents Supabase's localStorage
// auth broadcast from bleeding into other open windows.
let tabKey = window.sessionStorage.getItem('_sb_tab_key')
if (!tabKey) {
  tabKey = 'sb-auth-' + crypto.randomUUID().slice(0, 8)
  window.sessionStorage.setItem('_sb_tab_key', tabKey)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: window.sessionStorage,
    storageKey: tabKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
})