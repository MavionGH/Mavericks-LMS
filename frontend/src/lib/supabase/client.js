import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 * Used in Client Components ("use client") for OAuth triggers,
 * session reads, and sign-out calls.
 * Sessions are stored in cookies (handled by @supabase/ssr).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
