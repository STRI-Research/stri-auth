import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, config } from "./core";
import { unauthorizedResponse } from "./http";

function redirectToSuite(request: NextRequest): NextResponse {
  const loginUrl = new URL("/api/auth/app-login", config.suiteUrl());
  loginUrl.searchParams.set("app", config.appName());
  loginUrl.searchParams.set("returnUrl", request.url);
  return NextResponse.redirect(loginUrl.toString());
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
  if (request.nextUrl.pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const reject = () =>
    isDataRequest(request) ? unauthorizedResponse() : redirectToSuite(request);

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
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
