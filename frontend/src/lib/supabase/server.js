import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client.
 * Used in Route Handlers, Server Components, and Middleware.
 * Reads and writes session from HTTP cookies automatically.
 *
 * Must be called inside an async context that has access to `cookies()`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is called from Server Components where cookies can't be set.
            // The middleware will handle session refresh instead.
          }
        },
      },
    }
  );
}

/**
 * Admin Supabase client with service_role key.
 * Bypasses Row-Level Security — used ONLY for server-side
 * account-linking operations in the OAuth callback.
 * NEVER expose this client to the browser.
 */
export async function createAdminClient() {
  const { createClient: createSupabaseClient } = await import(
    "@supabase/supabase-js"
  );
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
