import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

/**
 * Next.js Middleware
 *
 * Runs on every matched request before the page renders.
 * Responsibilities:
 *  1. Refresh the Supabase session when the access token has expired.
 *  2. Protect authenticated routes — redirect to /login when no session.
 *  3. Redirect already-authenticated users away from /login and /register.
 */

// Routes that require an authenticated session.
const PROTECTED_PATHS = [
  "/dashboard",
  "/teacher",
  "/admin",
  "/learn",
  "/interview",
  "/quiz",
  "/courses",
  "/certificates",
];

// Routes that should NOT be accessible once logged in.
const AUTH_PATHS = ["/login", "/register"];

export async function middleware(request) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write cookies onto both the request (for this middleware call)
          // and the response (so the browser receives them).
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not add logic between createServerClient and getUser().
  // A simple mistake here could make it hard to debug session refresh issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // If visiting a protected path without a session → redirect to /login
  const isProtected = PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If logged-in user visits /login or /register → redirect to /dashboard
  const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p));
  if (isAuthPage && user) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashboardUrl);
  }

  // Return the (potentially cookie-refreshed) response
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico
     * - /auth/callback (must always be reachable without a session)
     */
    "/((?!_next/static|_next/image|favicon.ico|auth/callback).*)",
  ],
};
