import { cookies } from "next/headers";
import { verifyToken, payloadToUser, config, type StriUser } from "./core";

export type { StriUser } from "./core";

/**
 * The signed-in user, read from the session cookie, or null when there is no
 * valid session. Use in server components, route handlers and server actions:
 *
 *   import { getUser } from "@stri/auth";
 *   const user = await getUser();
 *
 * Middleware should already have redirected an unauthenticated page request, so
 * a null here on an API route means an unauthenticated call — return 401.
 */
export async function getUser(): Promise<StriUser | null> {
  const store = await cookies();
  const session = store.get(config.cookieName);
  if (!session?.value) return null;

  const payload = await verifyToken(session.value);
  return payload ? payloadToUser(payload) : null;
}

export {
  requireCaller,
  requireRole,
  withCaller,
  UnauthorizedError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "./caller";
