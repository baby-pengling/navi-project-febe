/// <reference types="vite/client" />
import type { NaviBridge } from '../../preload'

declare global {
  interface Window {
    navi: NaviBridge
  }
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
