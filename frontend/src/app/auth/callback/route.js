import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

/**
 * GET /auth/callback
 *
 * PKCE OAuth callback handler.
 *
 * Flow:
 *  1. Read the `code` query param sent by Supabase after Google consent.
 *  2. Exchange the code for a session (this sets the session cookies).
 *  3. Fetch the authenticated user from Supabase auth.users.
 *  4. Check whether the email already exists in public.users:
 *     a. EXISTING USER (email match, different ID) — account linking:
 *        Update all foreign-key references then update the users.id.
 *     b. NEW USER — insert a fresh record in public.users.
 *  5. Redirect to the appropriate dashboard based on role.
 *  6. On any error, redirect to /auth/error with a message.
 */
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` is optionally passed as state so we can redirect back to where the
  // user was before they clicked "Sign in with Google".
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return redirectToError(origin, "No authorisation code received from Google.");
  }

  try {
    const supabase = await createClient();

    // ── 1. Exchange the PKCE code for a session ──────────────────────────
    const { data: sessionData, error: sessionError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (sessionError) {
      console.error("[auth/callback] exchangeCodeForSession error:", sessionError);
      return redirectToError(
        origin,
        sessionError.message || "Failed to exchange authorisation code."
      );
    }

    const supabaseUser = sessionData?.user;
    if (!supabaseUser) {
      return redirectToError(origin, "No user returned after code exchange.");
    }

    const newId    = supabaseUser.id;   // UUID from Supabase auth.users
    const email    = supabaseUser.email;
    const name     = supabaseUser.user_metadata?.full_name ||
                     supabaseUser.user_metadata?.name ||
                     email.split("@")[0];
    const avatar   = supabaseUser.user_metadata?.avatar_url ?? null;

    // ── 2. Check public.users for an existing record with this email ──────
    const admin = await createAdminClient();

    const { data: existingRows, error: lookupError } = await admin
      .from("users")
      .select("id, role")
      .eq("email", email)
      .limit(1);

    if (lookupError) {
      console.error("[auth/callback] users lookup error:", lookupError);
      return redirectToError(origin, "Database lookup failed.");
    }

    let role = "STUDENT"; // PostgreSQL enum label (SQLAlchemy stores names, not values)

    if (existingRows && existingRows.length > 0) {
      const existing = existingRows[0];

      if (existing.id !== newId) {
        // ── 3a. ACCOUNT LINKING ─────────────────────────────────────────
        // A user who previously signed up with email/password now signs in
        // with Google using the same email. We must migrate their data from
        // the old custom UUID to the new Supabase auth UUID without losing
        // any enrollments, evaluations, etc.

        const oldId = existing.id;
        role = existing.role;

        // Tables with user_id FK (in dependency order — safest to update
        // child tables before the parent users row).
        const FK_TABLES = [
          "enrollments",
          "quiz_attempts",
          "interview_sessions",
          "evaluations",
          "certificates",
        ];

        for (const table of FK_TABLES) {
          const { error: fkErr } = await admin
            .from(table)
            .update({ user_id: newId })
            .eq("user_id", oldId);

          if (fkErr) {
            // Log but don't abort — some tables may simply have no rows.
            console.warn(`[auth/callback] updating ${table}.user_id:`, fkErr.message);
          }
        }

        // Now update the primary key on public.users
        const { error: idUpdateErr } = await admin
          .from("users")
          .update({ id: newId, avatar })
          .eq("id", oldId);

        if (idUpdateErr) {
          console.error("[auth/callback] users.id update error:", idUpdateErr);
          return redirectToError(
            origin,
            "Account linking failed. Please contact support."
          );
        }
      } else {
        // Same Supabase UUID already present — just refresh the avatar.
        role = existing.role;
        await admin.from("users").update({ avatar }).eq("id", newId);
      }
    } else {
      // ── 3b. NEW USER — first Google sign-in ────────────────────────────
      const { error: insertError } = await admin.from("users").insert({
        id:         newId,
        name,
        email,
        password:   "",        // No password for OAuth users
        role:       "STUDENT", // PostgreSQL enum uses uppercase names (STUDENT, TEACHER, ADMIN)
        avatar,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error("[auth/callback] insert new user error:", insertError);
        return redirectToError(origin, "Failed to create user profile.");
      }

      role = "STUDENT";
    }

    // ── 4. Redirect to the correct panel ─────────────────────────────────
    // Normalize role: DB may return "STUDENT" or "student" depending on PostgREST version
    const roleKey = (role || "STUDENT").toUpperCase();
    const PANEL_MAP = {
      STUDENT: "/dashboard",
      TEACHER: "/teacher",
      ADMIN:   "/admin",
    };
    const destination = PANEL_MAP[roleKey] ?? "/dashboard";
    return NextResponse.redirect(new URL(destination, origin));

  } catch (err) {
    console.error("[auth/callback] unexpected error:", err);
    return redirectToError(origin, "An unexpected error occurred. Please try again.");
  }
}

function redirectToError(origin, message) {
  const url = new URL("/auth/error", origin);
  url.searchParams.set("message", message);
  return NextResponse.redirect(url);
}
