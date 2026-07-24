import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, config } from "./core";

/**
 * Exchanges a Suite-issued token for this app's session cookie.
 * Re-export from `src/app/api/auth/callback/route.ts`:
 *
 *   export { GET } from "@stri/auth/callback";
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const returnUrl = request.nextUrl.searchParams.get("returnUrl") || "/";

  if (!token) {
    return NextResponse.json({ error: "No token provided" }, { status: 400 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Only ever redirect back into this app — never to an external host.
  let destination: URL;
  try {
    destination = new URL(returnUrl, request.nextUrl.origin);
  } catch {
    destination = new URL("/", request.nextUrl.origin);
  }
  if (destination.origin !== request.nextUrl.origin) {
    destination = new URL("/", request.nextUrl.origin);
  }

  const response = NextResponse.redirect(destination);
  response.cookies.set(config.cookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: config.sessionMaxAge,
    path: "/",
  });
  return response;
}
