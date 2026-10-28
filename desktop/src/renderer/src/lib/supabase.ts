import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/// The OAuth / email-confirmation callback the Swift app registers (`navi://auth-callback`).
export const REDIRECT_URL = 'navi://auth-callback'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configurationError: string | null =
  !url || !anonKey || url.includes('your-project-ref') || anonKey.includes('your-anon-key')
    ? 'Supabase 설정이 없습니다. .env 파일을 확인해 주세요.'
    : null

/// One client per window. The session lives in the main process's encrypted store (the
/// Swift app's Keychain), and supabase-js keeps the main window and the widget in sync.
export const supabase: SupabaseClient | null = configurationError
  ? null
  : createClient(url!, anonKey!, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: {
          getItem: (key) => window.navi.secureStore.get(key),
          setItem: (key, value) => window.navi.secureStore.set(key, value),
          removeItem: (key) => window.navi.secureStore.remove(key)
        }
      }
    })
