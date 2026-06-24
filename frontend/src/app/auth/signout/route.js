import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /auth/signout
 *
 * Server-side sign-out handler.
 * Calls supabase.auth.signOut() which invalidates the refresh token on
 * the server and removes all session cookies from the response.
 */
export async function POST(request) {
  const { origin } = new URL(request.url);

  try {
    const supabase = await createClient();

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("[auth/signout] signOut error:", error);
    }
  } catch (err) {
    console.error("[auth/signout] unexpected error:", err);
  }

  // Always redirect to /login, even if signOut had an error,
  // to ensure the UI reflects a logged-out state.
  return NextResponse.redirect(new URL("/login", origin));
}
