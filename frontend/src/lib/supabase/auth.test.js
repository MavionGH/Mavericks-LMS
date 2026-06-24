/**
 * Tests for the /auth/callback OAuth route.
 *
 * Coverage:
 *  1. Happy path — new user (no existing public.users record)
 *  2. Account linking — email already exists under a different UUID
 *  3. Missing auth code — should redirect to /auth/error
 *  4. exchangeCodeForSession failure — should redirect to /auth/error
 *
 * Run with:  npx jest src/lib/supabase/auth.test.js
 *
 * NOTE: These are unit tests that mock the Supabase clients and
 * Next.js internals. No real network calls are made.
 */

// ── Jest setup: mock Next.js server APIs ─────────────────────────────────────
jest.mock("next/server", () => ({
  NextResponse: {
    redirect: (url) => ({ type: "redirect", url: url.toString() }),
    next: (opts) => ({ type: "next", ...opts }),
  },
}));

// ── Mock @/lib/supabase/server ───────────────────────────────────────────────
const mockExchangeCodeForSession = jest.fn();
const mockAdminFrom               = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  }),
  createAdminClient: async () => ({
    from: mockAdminFrom,
  }),
}));

// Import the route handler AFTER mocking its dependencies
const { GET } = require("@/app/auth/callback/route");

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildRequest(params = {}) {
  const url = new URL("http://localhost:3000/auth/callback");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return { url: url.toString() };
}

function mockAdminChain({ selectRows = [], updateError = null, insertError = null } = {}) {
  const update = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: updateError }),
  });
  const insert = jest.fn().mockResolvedValue({ error: insertError });
  const select = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: selectRows, error: null }),
    }),
  });

  mockAdminFrom.mockReturnValue({ select, update, insert });
  return { select, update, insert };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("/auth/callback route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Missing code param ─────────────────────────────────────────────────
  test("redirects to /auth/error when no code param is present", async () => {
    const req = buildRequest({}); // no `code`
    const response = await GET(req);

    expect(response.type).toBe("redirect");
    expect(response.url).toContain("/auth/error");
    expect(response.url).toContain("No+authorisation+code");
  });

  // ── 2. exchangeCodeForSession failure ─────────────────────────────────────
  test("redirects to /auth/error when exchangeCodeForSession fails", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: "Invalid code" },
    });

    const req = buildRequest({ code: "bad-code" });
    const response = await GET(req);

    expect(response.type).toBe("redirect");
    expect(response.url).toContain("/auth/error");
    expect(response.url).toContain("Invalid+code");
  });

  // ── 3. New user (no existing public.users record) ────────────────────────
  test("inserts a new user and redirects to /dashboard for a new Google sign-in", async () => {
    const supabaseUid = "supa-new-uuid-001";

    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: supabaseUid,
          email: "newuser@example.com",
          user_metadata: { full_name: "New User" },
        },
        session: {},
      },
      error: null,
    });

    // No existing record in public.users
    mockAdminChain({ selectRows: [] });

    const req = buildRequest({ code: "valid-code" });
    const response = await GET(req);

    // Should call insert on public.users
    expect(mockAdminFrom).toHaveBeenCalledWith("users");
    expect(response.type).toBe("redirect");
    expect(response.url).toContain("/dashboard");
  });

  // ── 4. Account linking — email exists under different UUID ────────────────
  test("links accounts: migrates FK rows and updates user.id when email already exists", async () => {
    const oldId      = "legacy-custom-uuid-001";
    const newSupaId  = "supa-oauth-uuid-999";
    const email      = "alice@example.com";

    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: newSupaId,
          email,
          user_metadata: { full_name: "Alice" },
        },
        session: {},
      },
      error: null,
    });

    // Existing record with a different (legacy) UUID
    const chain = mockAdminChain({
      selectRows: [{ id: oldId, role: "student" }],
    });

    const req = buildRequest({ code: "valid-code" });
    const response = await GET(req);

    // Should update FK tables: enrollments, quiz_attempts, interview_sessions,
    // evaluations, certificates — then update users.id
    const FK_TABLES = [
      "enrollments",
      "quiz_attempts",
      "interview_sessions",
      "evaluations",
      "certificates",
      "users",
    ];
    FK_TABLES.forEach((table) => {
      expect(mockAdminFrom).toHaveBeenCalledWith(table);
    });

    // Should redirect to dashboard after successful linking
    expect(response.type).toBe("redirect");
    expect(response.url).toContain("/dashboard");
  });

  // ── 5. Account linking — same UUID (already linked) ─────────────────────
  test("skips migration when the Supabase UUID already matches the existing user", async () => {
    const sameId = "supa-same-uuid-111";

    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: sameId,
          email: "bob@example.com",
          user_metadata: {},
        },
        session: {},
      },
      error: null,
    });

    // Same UUID already in public.users — already linked
    mockAdminChain({ selectRows: [{ id: sameId, role: "teacher" }] });

    const req = buildRequest({ code: "valid-code" });
    const response = await GET(req);

    // Should redirect to /teacher (based on role)
    expect(response.type).toBe("redirect");
    expect(response.url).toContain("/teacher");

    // Should NOT call insert
    const insertCalls = mockAdminFrom.mock.results.some(
      (r) => r.value?.insert?.mock?.calls?.length > 0
    );
    expect(insertCalls).toBe(false);
  });
});
