import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, config } from "./core";

function redirectToSuite(request: NextRequest): NextResponse {
  const loginUrl = new URL("/api/auth/app-login", config.suiteUrl());
  loginUrl.searchParams.set("app", config.appName());
  loginUrl.searchParams.set("returnUrl", request.url);
  return NextResponse.redirect(loginUrl.toString());
}

/**
 * Data routes must fail with a status code, never a redirect. fetch() follows
 * redirects transparently, so redirecting an expired XHR to Suite either costs a
 * multi-hop round trip per call or returns the sign-in HTML, which the caller
 * then parses as JSON — hanging the UI on a loading state forever.
 */
function unauthorized(): NextResponse {
  const response = NextResponse.json(
    { error: "Unauthorized", reason: "stri-session missing or expired" },
    { status: 401 }
  );
  response.cookies.delete(config.cookieName);
  return response;
}

function isDataRequest(request: NextRequest): boolean {
  return (
    request.nextUrl.pathname.startsWith("/api/") ||
    request.headers.get("accept")?.includes("application/json") === true
  );
}

/**
 * STRI Suite auth gate. Re-export from the app's `src/middleware.ts`:
 *
 *   export { middleware } from "@stri/auth/middleware";
 *   export { defaultConfig as config } from "@stri/auth/middleware";
 *
 * Apps with routes that must stay public (mobile, cron, webhooks) define their
 * own `config` with the extra matcher exclusions instead of re-exporting
 * `defaultConfig`.
 */
export async function middleware(request: NextRequest) {
  // Anchor to a path boundary: exempt `/api/auth` and `/api/auth/...` only.
  // A bare `startsWith("/api/auth")` also matches app routes like
  // `/api/authors` or `/api/authorize`, leaving them completely unauthenticated.
  const { pathname } = request.nextUrl;
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const reject = () =>
    isDataRequest(request) ? unauthorized() : redirectToSuite(request);

  const session = request.cookies.get(config.cookieName);
  if (!session?.value) return reject();

  const payload = await verifyToken(session.value);
  if (!payload) {
    const response = reject();
    response.cookies.delete(config.cookieName);
    return response;
  }

  return NextResponse.next();
}

export const defaultConfig = {
  matcher: [
    "/((?!api/auth/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
