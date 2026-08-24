import { NextResponse } from "next/server";
import { config } from "./core";

/**
 * The estate's single 401 response shape.
 *
 * Data routes must fail with a status code, never a redirect. fetch() follows
 * redirects transparently, so redirecting an expired XHR to Suite either costs a
 * multi-hop round trip per call or returns the sign-in HTML, which the caller
 * then parses as JSON — hanging the UI on a loading state forever.
 *
 * Lives here rather than in middleware.ts so the gate and the per-route
 * `requireCaller()` cannot drift apart. Two copies of this that disagree is
 * exactly the failure this package exists to prevent.
 */
export function unauthorizedResponse(): NextResponse {
  const response = NextResponse.json(
    { error: "Unauthorized", reason: "stri-session missing or expired" },
    { status: 401 }
  );
  response.cookies.delete(config.cookieName);
  return response;
}

/**
 * 403 for a caller who IS authenticated but lacks the capability. Distinct from
 * 401 on purpose: a 401 tells the client to re-authenticate, which is wrong and
 * produces a redirect loop when the real problem is permissions.
 */
export function forbiddenResponse(reason = "insufficient permissions"): NextResponse {
  return NextResponse.json({ error: "Forbidden", reason }, { status: 403 });
}
