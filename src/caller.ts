import { cookies } from "next/headers";
import { verifyToken, payloadToUser, config, type StriUser } from "./core";
import { unauthorizedResponse, forbiddenResponse } from "./http";

export type { StriUser } from "./core";
export { unauthorizedResponse, forbiddenResponse } from "./http";

/**
 * Thrown by `requireCaller()` when there is no valid session. `withCaller()`
 * converts it to a 401; if you call `requireCaller()` outside a wrapper, let it
 * propagate — an unhandled throw is a 500, which fails closed.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("No valid stri-session");
    this.name = "UnauthorizedError";
  }
}

/** Thrown by `requireRole()`. `withCaller()` converts it to a 403. */
export class ForbiddenError extends Error {
  constructor(public readonly reason = "insufficient permissions") {
    super(reason);
    this.name = "ForbiddenError";
  }
}

async function readCaller(): Promise<StriUser | null> {
  const store = await cookies();
  const session = store.get(config.cookieName);
  if (!session?.value) return null;
  const payload = await verifyToken(session.value);
  return payload ? payloadToUser(payload) : null;
}

/**
 * The signed-in user, or a thrown `UnauthorizedError`. Prefer this over
 * `getUser()` in anything that touches data.
 *
 * `getUser()` returns `StriUser | null`, which means every call site has to
 * remember the null check — and the estate audit repeatedly finds route handlers
 * that resolve a caller and then never look at it. This signature removes that
 * possibility: there is no null branch to forget, because there is no null.
 *
 *   export const GET = withCaller(async (caller) => {
 *     return Response.json(await listFor(caller.id));
 *   });
 *
 * Middleware should already have rejected an unauthenticated page request, so a
 * failure here on an API route means the matcher does not cover it — which is
 * itself worth knowing.
 */
export async function requireCaller(): Promise<StriUser> {
  const caller = await readCaller();
  if (!caller) throw new UnauthorizedError();
  return caller;
}

/**
 * Assert the caller holds one of `roles`. Returns the caller so it composes:
 *
 *   const caller = await requireRole("admin");
 *
 * Note this reads the role from the **token**, which is minted at sign-in and
 * lives for the session TTL. For a decision that must reflect a change made
 * seconds ago — a demotion, a revoked grant — read the role from your own
 * database instead. Suite's own `app-login` does exactly that, deliberately.
 */
export async function requireRole(...roles: string[]): Promise<StriUser> {
  const caller = await requireCaller();
  if (!roles.includes(caller.role)) {
    throw new ForbiddenError(`requires one of: ${roles.join(", ")}`);
  }
  return caller;
}

type Handler<Ctx> = (
  caller: StriUser,
  request: Request,
  context: Ctx
) => Promise<Response> | Response;

/**
 * Wrap a route handler so the caller is resolved before it runs and the
 * unauthenticated case is answered consistently.
 *
 * The point is not convenience — it is that the 401 path stops being something
 * each route re-implements (or forgets). A handler wrapped in this cannot run
 * without a caller, and the caller is its first argument, so an unused-parameter
 * lint rule will flag any handler that ignores it.
 *
 *   export const DELETE = withCaller(async (caller, _req, { params }) => {
 *     const { id } = await params;
 *     const job = await load(id);
 *     if (job.ownerId !== caller.id) return forbiddenResponse("not your job");
 *     await remove(id);
 *     return new Response(null, { status: 204 });
 *   });
 */
export function withCaller<Ctx = unknown>(handler: Handler<Ctx>) {
  return async (request: Request, context: Ctx): Promise<Response> => {
    let caller: StriUser;
    try {
      caller = await requireCaller();
    } catch (err) {
      if (err instanceof UnauthorizedError) return unauthorizedResponse();
      throw err;
    }

    try {
      return await handler(caller, request, context);
    } catch (err) {
      if (err instanceof ForbiddenError) return forbiddenResponse(err.reason);
      if (err instanceof UnauthorizedError) return unauthorizedResponse();
      throw err;
    }
  };
}
