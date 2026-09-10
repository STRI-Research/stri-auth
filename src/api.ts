import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyActorToken } from "./core";

/**
 * App-to-app API keys.
 *
 * Each STRI app issues keys to named consumer apps from its own admin page and
 * verifies them here on every `/api/v1` request. The design, and the reasons
 * for it, are in STRISuite `docs/api/README.md`. The short version:
 *
 *   - A key is `stri_<app>_<43 base64url chars>`. Only its SHA-256 hash is
 *     stored. It identifies the consuming *app*, never a person.
 *   - Scopes are fixed at mint time. A route asks for one scope; the key
 *     either carries it or gets a 403.
 *   - Keys are bound to one environment (production / preview / development)
 *     and refuse to work anywhere else.
 *   - To act for a person the caller forwards that person's Suite session JWT
 *     in `X-STRI-Actor`. We verify the signature, not the caller's word.
 *
 * This module is server-only (Node crypto). Route handlers call
 * `requireWorkload` first and return its Response when it hands one back.
 */

export type Environment = "production" | "preview" | "development";

export interface ApiKeyRecord {
  id: string;
  name: string;
  /** Suite App name of the app that holds this key. */
  consumer: string;
  prefix: string;
  hash: string;
  scopes: string[];
  environment: Environment;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  useCount: number;
}

/** What an app supplies over its own ORM. Five lines of adapter, typically. */
export interface KeyStore {
  findByHash(hash: string): Promise<ApiKeyRecord | null>;
  /** Stamp last-used. Called in the background; failures are swallowed. */
  touch(id: string): Promise<void>;
}

export interface Actor {
  /** Suite account id — the JWT `sub`. Key local people on this. */
  suiteUserId: string;
  email: string;
  name: string;
  /** Suite role (ADMIN / CREATOR / USER). Not an app role. */
  suiteRole: string;
}

export interface Workload {
  kind: "api-key";
  keyId: string;
  /** Suite App name of the calling app. Goes in audit rows as `via`. */
  consumer: string;
  scopes: string[];
  environment: Environment;
  /** Present when a valid `X-STRI-Actor` was forwarded. */
  actor: Actor | null;
}

export interface RequireOptions {
  /** One scope, or several of which the key must hold ALL. */
  scope?: string | string[];
  /**
   * `required`: refuse without a valid actor (403 actor_required).
   * `optional`: accept and expose one if present (default).
   * `none`: ignore the header entirely.
   */
  actor?: "required" | "optional" | "none";
}

// ── Key material ──────────────────────────────────────────────────────────

export const KEY_PREFIX = "stri_";
/** Legacy Suite alert keys, accepted so nothing rotates on the day. */
export const LEGACY_PREFIXES = ["ska_"];

const SLUG = /^[a-z][a-z0-9-]{1,30}$/;

export interface MintedKey {
  /** Shown once, at creation, never retrievable again. */
  secret: string;
  hash: string;
  prefix: string;
}

/** `stri_<app>_` + 32 random bytes base64url. 256 bits of entropy. */
export function mintKey(appSlug: string): MintedKey {
  if (!SLUG.test(appSlug)) {
    throw new Error(`Invalid app slug "${appSlug}": lowercase letters, digits, hyphens`);
  }
  const secret = `${KEY_PREFIX}${appSlug}_${randomBytes(32).toString("base64url")}`;
  return { secret, hash: hashKey(secret), prefix: secret.slice(0, 16) };
}

export function hashKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function looksLikeKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX) || LEGACY_PREFIXES.some((p) => token.startsWith(p));
}

/** Constant-time compare that stays flat on a length mismatch too. */
function hashesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── Environment ───────────────────────────────────────────────────────────

/**
 * Where this code is running, from Vercel's own variable. A key minted for
 * `preview` cannot reach a production deployment and vice versa: preview code
 * holding a preview key still cannot read production data.
 */
export function currentEnvironment(): Environment {
  const v = process.env.VERCEL_ENV;
  if (v === "production" || v === "preview") return v;
  return "development";
}

// ── Errors ────────────────────────────────────────────────────────────────

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "insufficient_scope"
  | "actor_required"
  | "actor_invalid"
  | "person_not_resolved"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | (string & {});

/** The `{ error, code, details? }` shape every STRI API returns. */
export function apiError(
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  headers?: HeadersInit
): Response {
  const body: Record<string, unknown> = { error: message, code };
  if (details) body.details = details;
  return Response.json(body, { status, headers });
}

export const errors = {
  unauthenticated: (why = "Missing, unknown, revoked or expired API key") =>
    apiError(401, "unauthenticated", why, undefined, {
      "WWW-Authenticate": 'Bearer realm="stri", error="invalid_token"',
    }),
  scope: (required: string[], granted: string[]) =>
    apiError(403, "insufficient_scope", `Key does not carry the ${required.join(", ")} scope`, {
      required: required.length === 1 ? required[0] : required,
      granted,
    }),
  actorRequired: () =>
    apiError(403, "actor_required", "This endpoint records something on behalf of a person; forward their Suite session in X-STRI-Actor"),
  actorInvalid: () =>
    apiError(403, "actor_invalid", "X-STRI-Actor is not a valid, unexpired Suite session token"),
  personNotResolved: (suiteUserId: string) =>
    apiError(409, "person_not_resolved", "The actor has no person record in this app", { suiteUserId }),
  forbidden: (message = "Forbidden") => apiError(403, "forbidden", message),
  notFound: (message = "Not found") => apiError(404, "not_found", message),
  conflict: (message: string, details?: Record<string, unknown>) =>
    apiError(409, "conflict", message, details),
  validation: (message: string, details?: Record<string, unknown>) =>
    apiError(400, "validation", message, details),
};

// ── The gate ──────────────────────────────────────────────────────────────

const TOUCH_INTERVAL_MS = 60_000;
const lastTouched = new Map<string, number>();

/**
 * Authenticate and authorise a machine caller. Returns the workload on
 * success, or a ready-to-return Response (401/403) on failure.
 *
 *   const caller = await requireWorkload(req, keyStore, { scope: "jobs:read" });
 *   if (caller instanceof Response) return caller;
 */
export async function requireWorkload(
  req: Request,
  store: KeyStore,
  opts: RequireOptions = {}
): Promise<Workload | Response> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = m?.[1]?.trim();
  if (!token) return errors.unauthenticated("Missing Authorization: Bearer header");

  // A Suite-issued workload JWT (three dot-separated parts) is not accepted
  // yet: the Suite does not mint them. When it does, this is where they go,
  // and consumers will not need to change what they send.
  if (!looksLikeKey(token)) {
    return errors.unauthenticated();
  }

  const hash = hashKey(token);
  const key = await store.findByHash(hash);
  if (!key || !hashesMatch(hash, key.hash)) return errors.unauthenticated();
  if (key.revokedAt) return errors.unauthenticated("API key has been revoked");
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    return errors.unauthenticated("API key has expired");
  }

  const env = currentEnvironment();
  if (key.environment !== env) {
    return errors.unauthenticated(`This is a ${key.environment} key; the deployment is ${env}`);
  }

  const required = opts.scope === undefined ? [] : Array.isArray(opts.scope) ? opts.scope : [opts.scope];
  const missing = required.filter((s) => !key.scopes.includes(s));
  if (missing.length) return errors.scope(missing, key.scopes);

  let actor: Actor | null = null;
  const actorMode = opts.actor ?? "optional";
  if (actorMode !== "none") {
    const raw = req.headers.get("x-stri-actor")?.trim();
    if (raw) {
      const payload = await verifyActorToken(raw);
      if (!payload) return errors.actorInvalid();
      actor = {
        suiteUserId: payload.sub as string,
        email: String(payload.email ?? ""),
        name: String(payload.name ?? ""),
        suiteRole: String(payload.role ?? ""),
      };
    }
    if (actorMode === "required" && !actor) return errors.actorRequired();
  }

  const now = Date.now();
  if ((lastTouched.get(key.id) ?? 0) + TOUCH_INTERVAL_MS < now) {
    lastTouched.set(key.id, now);
    void store.touch(key.id).catch(() => {});
  }

  return {
    kind: "api-key",
    keyId: key.id,
    consumer: key.consumer,
    scopes: key.scopes,
    environment: key.environment,
    actor,
  };
}

/** Type guard for the `requireWorkload` result. */
export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}

// ── Pagination helpers ────────────────────────────────────────────────────

/** Opaque cursor: base64url JSON. Never let a consumer construct one by hand. */
export function encodeCursor(v: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}

export function decodeCursor<T extends Record<string, unknown>>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Parse `?limit=` within [1, max], default 50. */
export function pageLimit(url: URL, max = 200, fallback = 50): number {
  const n = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

/** The `{ items, nextCursor }` list envelope. */
export function page<T>(items: T[], nextCursor: string | null): { items: T[]; nextCursor: string | null } {
  return { items, nextCursor };
}
