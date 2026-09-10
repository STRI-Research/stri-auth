import {
  mintKey,
  currentEnvironment,
  errors,
  type ApiKeyRecord,
  type KeyStore,
  type Environment,
} from "./api";

/**
 * Drop-in route handlers for an app's key-management endpoints:
 *
 *   GET    /api/v1/api-keys        list keys this app has issued
 *   POST   /api/v1/api-keys        mint one (secret shown once)
 *   DELETE /api/v1/api-keys/{id}   revoke
 *
 * These are session-authenticated — a person operates them from the app's
 * admin page — never key-authenticated. Keys cannot manage keys. The app
 * supplies `isAdmin()`, which must read the person's role fresh from its own
 * tables, not from the JWT.
 *
 *   // src/app/api/v1/api-keys/route.ts
 *   const h = createApiKeyHandlers({ appSlug: "art", scopes: SCOPES, store, isAdmin });
 *   export const GET = h.GET; export const POST = h.POST;
 *
 *   // src/app/api/v1/api-keys/[id]/route.ts
 *   export const DELETE = h.DELETE;
 */

export interface AdminKeyStore extends KeyStore {
  list(): Promise<ApiKeyRecord[]>;
  create(rec: Omit<ApiKeyRecord, "id" | "createdAt" | "lastUsedAt" | "useCount" | "revokedAt">): Promise<ApiKeyRecord>;
  /** Returns false when the id is unknown. Idempotent when already revoked. */
  revoke(id: string): Promise<boolean>;
}

export interface ApiKeyHandlerOptions {
  /** Goes into the key: `stri_<appSlug>_…`. Lowercase, hyphens allowed. */
  appSlug: string;
  /** The scopes this app declares (`x-stri-scopes` in its spec). */
  scopes: readonly string[];
  store: AdminKeyStore;
  /** Resolve the signed-in person and confirm they may manage keys. Null → 403. */
  isAdmin: (req: Request) => Promise<{ id: string } | null>;
  /** Default expiry in days. Spec default is one year. */
  defaultExpiryDays?: number;
}

const MAX_EXPIRY_DAYS = 730;
const ENVIRONMENTS: Environment[] = ["production", "preview", "development"];

/** Never return the hash. */
export function toPublicKey(k: ApiKeyRecord) {
  return {
    id: k.id,
    name: k.name,
    consumer: k.consumer,
    prefix: k.prefix,
    scopes: k.scopes,
    environment: k.environment,
    createdBy: k.createdBy,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    useCount: k.useCount,
  };
}

/**
 * Tell the Suite a key exists so the estate-wide integration registry stays
 * correct without anyone maintaining it. Best-effort: the registry endpoint
 * lands with the Suite's own API work, and until then (or if the Suite is
 * down) minting must still succeed. Needs STRI_SUITE_API_KEY with the
 * `integrations:write` scope.
 */
async function registerWithSuite(k: ApiKeyRecord): Promise<void> {
  const suite = process.env.STRI_SUITE_URL;
  const key = process.env.STRI_SUITE_API_KEY;
  if (!suite || !key) return;
  try {
    await fetch(`${suite.replace(/\/$/, "")}/api/v1/integrations`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        consumer: k.consumer,
        keyId: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        environment: k.environment,
        createdBy: k.createdBy,
        createdAt: k.createdAt.toISOString(),
        expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Registry is advisory. The key is already minted and stored.
  }
}

async function revokeWithSuite(appSlug: string, id: string): Promise<void> {
  const suite = process.env.STRI_SUITE_URL;
  const key = process.env.STRI_SUITE_API_KEY;
  if (!suite || !key) return;
  try {
    await fetch(
      `${suite.replace(/\/$/, "")}/api/v1/integrations/${encodeURIComponent(appSlug)}/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ revokedAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000),
      }
    );
  } catch {
    // Advisory.
  }
}

export function createApiKeyHandlers(opts: ApiKeyHandlerOptions) {
  const defaultDays = opts.defaultExpiryDays ?? 365;

  async function GET(req: Request): Promise<Response> {
    const admin = await opts.isAdmin(req);
    if (!admin) return errors.forbidden("Only this app's admins can list API keys");
    const keys = await opts.store.list();
    return Response.json({ items: keys.map(toPublicKey) });
  }

  async function POST(req: Request): Promise<Response> {
    const admin = await opts.isAdmin(req);
    if (!admin) return errors.forbidden("Only this app's admins can mint API keys");

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return errors.validation("Body must be JSON");
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const consumer = typeof body.consumer === "string" ? body.consumer.trim() : "";
    const scopes = Array.isArray(body.scopes)
      ? [...new Set(body.scopes.filter((s): s is string => typeof s === "string"))]
      : [];
    const environment = (typeof body.environment === "string" ? body.environment : "production") as Environment;
    const expiresInDays =
      body.expiresInDays === undefined ? defaultDays : Number(body.expiresInDays);

    const problems: Record<string, string> = {};
    if (!name) problems.name = "required";
    if (name.length > 120) problems.name = "120 characters or fewer";
    if (!consumer) problems.consumer = "required — the Suite App name that will hold this key";
    if (!scopes.length) problems.scopes = "at least one scope";
    const unknown = scopes.filter((s) => !opts.scopes.includes(s));
    if (unknown.length) problems.scopes = `unknown scope(s): ${unknown.join(", ")}`;
    if (!ENVIRONMENTS.includes(environment)) problems.environment = `one of ${ENVIRONMENTS.join(", ")}`;
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_EXPIRY_DAYS) {
      problems.expiresInDays = `integer between 1 and ${MAX_EXPIRY_DAYS}`;
    }
    if (Object.keys(problems).length) return errors.validation("Invalid key request", problems);

    const minted = mintKey(opts.appSlug);
    const created = await opts.store.create({
      name,
      consumer,
      prefix: minted.prefix,
      hash: minted.hash,
      scopes,
      environment,
      createdBy: admin.id,
      expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
    });

    void registerWithSuite(created);

    return Response.json({ ...toPublicKey(created), secret: minted.secret }, { status: 201 });
  }

  /** For `[id]/route.ts`. Reads the id from the last path segment. */
  async function DELETE(req: Request, ctx?: { params: Promise<{ id: string }> | { id: string } }): Promise<Response> {
    const admin = await opts.isAdmin(req);
    if (!admin) return errors.forbidden("Only this app's admins can revoke API keys");
    const params = ctx ? await ctx.params : undefined;
    const id = params?.id ?? new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
    if (!id) return errors.validation("Key id required");
    const ok = await opts.store.revoke(id);
    if (!ok) return errors.notFound("No such key");
    void revokeWithSuite(opts.appSlug, id);
    return new Response(null, { status: 204 });
  }

  return { GET, POST, DELETE, environment: currentEnvironment };
}
