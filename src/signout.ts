import { NextResponse, type NextRequest } from "next/server";
import { config } from "./core";

/**
 * Signs the user out of this app AND of STRI Suite. Clearing only the local
 * cookie is not enough — the next request would broker straight back in through
 * Suite, whose session is still live, so the user appears never to sign out.
 * Re-export from `src/app/api/auth/signout/route.ts`:
 *
 *   export { GET, POST } from "@stri/auth/signout";
 */
export async function GET(_request: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/api/auth/signout", config.suiteUrl())
  );
  response.cookies.delete(config.cookieName);
  return response;
}

export async function POST(request: NextRequest) {
  return GET(request);
}
