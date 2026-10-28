import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/// The OAuth / email-confirmation callback the Swift app registers (`navi://auth-callback`).
export const REDIRECT_URL = 'navi://auth-callback'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configurationError: string | null =
  !url || !anonKey || url.includes('your-project-ref') || anonKey.includes('your-anon-key')
    ? 'Supabase 설정이 없습니다. .env 파일을 확인해 주세요.'
    : null

/// Edge Function requests go through the main process (see `edge:fetch`): the gateway rejects
/// their CORS preflight. Everything else (Auth, PostgREST) is a normal browser fetch.
async function naviFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  if (!new URL(request.url).pathname.startsWith('/functions/v1/')) return fetch(request)
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer()
  const response = await window.navi.edgeFetch({
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: body && body.byteLength ? body : null
  })
  // 204/205/304 can't carry a body.
  const empty = [204, 205, 304].includes(response.status)
  return new Response(empty ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

/// One client per window. The session lives in the main process's encrypted store (the
/// Swift app's Keychain), and supabase-js keeps the main window and the widget in sync.
export const supabase: SupabaseClient | null = configurationError
  ? null
  : createClient(url!, anonKey!, {
      global: { fetch: naviFetch },
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
