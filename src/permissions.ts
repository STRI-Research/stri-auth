import { getUser } from "./index";
import type { StriUser } from "./core";

/**
 * User permissions, the same way in every app.
 *
 * Five apps answer "may this person do this?" five ways today: a role column on
 * a people table, a join table of roles, a single string on an app_user row,
 * and — in one case — no table at all, only the Suite's own ADMIN flag. The
 * differences are historical rather than meaningful, and they are why an
 * estate-wide question like "who can mint an API key in every app" takes five
 * queries to answer.
 *
 * This module is the one shape. An app supplies a five-line store over its own
 * ORM, declares its roles, and gets the resolver, the capability check and the
 * grant/revoke handlers. Rules P1–P4 in RULES.md.
 *
 * What it deliberately does NOT hold: names, emails, avatars. Display identity
 * is read from the Suite directory (`GET /api/v1/users/{id}`) and cached for
 * minutes at most. A name cached in a column goes stale silently, and a name
 * written back from a session token overwrote two people's email addresses in
 * the Planner's production database.
 *
 * A domain person row — somebody who is scheduled, assessed or rostered, who
 * may have no Suite account at all — is a different thing and keeps whatever
 * columns it needs. This governs the permissions path only.
 */

/** The canonical table. Copy into the app's migration verbatim. */
export const ACCESS_TABLE_SQL = `
create table if not exists app_access (
  suite_user_id text primary key,
  role          text not null,
  granted_by    text,
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create index if not exists app_access_role_idx on app_access (role);
`.trim();

export interface AccessRow {
  /** The Suite account id — the JWT `sub`. Never an email. */
  suiteUserId: string;
  /** One of the app's declared roles. */
  role: string;
  /** The granting admin's Suite account id. */
  grantedBy: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
}

/** What an app supplies over its own ORM. Five lines, typically. */
export interface AccessStore {
  find(suiteUserId: string): Promise<AccessRow | null>;
  list(): Promise<AccessRow[]>;
  grant(row: {
    suiteUserId: string;
    role: string;
    grantedBy: string;
  }): Promise<AccessRow>;
  /** Returns false when there is no such row. Idempotent when already revoked. */
  revoke(suiteUserId: string): Promise<boolean>;
}

export interface PermissionsOptions<Role extends string, Capability extends string> {
  store: AccessStore;
  /** Every role this app has, most privileged first. */
  roles: readonly Role[];
  /**
   * What each role may do. Capabilities are the app's own vocabulary — and are
   * worth spelling the same as its API scopes, so "what this person may do" and
   * "what this key may do" are one language.
   */
  capabilities: Record<Role, readonly Capability[]>;
  /**
   * The role given to somebody with a Suite session and no row, or `null` to
   * refuse them. Default: null — an app's access list is a list of decisions,
   * and "whoever signs in first becomes an admin" is not one.
   */
  defaultRole?: Role | null;
  /**
   * Suite roles that carry this app's most privileged role regardless of the
   * table. `["ADMIN"]` is the common answer: an estate administrator should not
   * be locked out of an app waiting to be granted a role in it. Set `[]` to
   * refuse even them.
   */
  suiteRolesAsAdmin?: readonly string[];
}

export interface Caller<Role extends string, Capability extends string> {
  /** The Suite account id. The only identity this app stores. */
  suiteUserId: string;
  /** From the session token, for display in this request only. Never persisted. */
  user: StriUser;
  role: Role;
  can(capability: Capability): boolean;
  /** True when the role came from a Suite ADMIN rather than from a row. */
  viaSuiteAdmin: boolean;
}

export function createPermissions<Role extends string, Capability extends string>(
  opts: PermissionsOptions<Role, Capability>
) {
  const suiteAdminRoles = opts.suiteRolesAsAdmin ?? ["ADMIN"];
  const topRole = opts.roles[0];

  function can(role: Role, capability: Capability): boolean {
    return (opts.capabilities[role] ?? []).includes(capability);
  }

  /**
   * The signed-in person, with what this app lets them do.
   *
   * The role is read from the table on every call, never from the JWT: a
   * demoted admin loses the page on their next request rather than at their
   * next login. `null` means no session, or a session with no access — the
   * caller decides which of those is a redirect and which is a 403.
   */
  async function getCaller(): Promise<Caller<Role, Capability> | null> {
    const user = await getUser();
    if (!user?.id) return null;

    const row = await opts.store.find(user.id);
    let role: Role | null = null;
    let viaSuiteAdmin = false;

    if (row && !row.revokedAt && opts.roles.includes(row.role as Role)) {
      role = row.role as Role;
    } else if (suiteAdminRoles.includes(String(user.role).toUpperCase())) {
      role = topRole;
      viaSuiteAdmin = true;
    } else if (opts.defaultRole) {
      role = opts.defaultRole;
    }
    if (!role) return null;

    return {
      suiteUserId: user.id,
      user,
      role,
      viaSuiteAdmin,
      can: (capability) => can(role as Role, capability),
    };
  }

  /** The caller, or null when they lack the capability. For a route's first line. */
  async function requireCapability(
    capability: Capability
  ): Promise<Caller<Role, Capability> | null> {
    const caller = await getCaller();
    return caller && caller.can(capability) ? caller : null;
  }

  return { getCaller, requireCapability, can, roles: opts.roles };
}

// ── The grant page's endpoints ──────────────────────────────────────────────

/**
 * Drop-in handlers for `/api/v1/access` (list, grant) and
 * `/api/v1/access/{suiteUserId}` (revoke).
 *
 * Session-authenticated and admin-only, like the key handlers: access is
 * granted by a person, from a page, and the grant records who made it (P4).
 * Roles that can only be changed with SQL are roles nobody maintains — Machine
 * Tracker's owner sat at `field` for a month because of exactly that.
 *
 * The response carries no names. A page that wants them asks the Suite
 * directory for the ids it just received.
 */
export function createAccessHandlers<Role extends string>(opts: {
  store: AccessStore;
  roles: readonly Role[];
  /** Resolve the operating admin, or null. Reads the role fresh, never the JWT. */
  isAdmin: (req: Request) => Promise<{ id: string } | null>;
}) {
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const toPublic = (r: AccessRow) => ({
    suiteUserId: r.suiteUserId,
    role: r.role,
    grantedBy: r.grantedBy,
    grantedAt: r.grantedAt.toISOString(),
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  });

  async function GET(req: Request): Promise<Response> {
    const admin = await opts.isAdmin(req);
    if (!admin) return json({ error: "Only this app's admins can read the access list", code: "forbidden" }, 403);
    const rows = await opts.store.list();
    return json({ items: rows.map(toPublic), roles: opts.roles });
  }

  async function POST(req: Request): Promise<Response> {
    const admin = await opts.isAdmin(req);
    if (!admin) return json({ error: "Only this app's admins can grant access", code: "forbidden" }, 403);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Body must be JSON", code: "validation" }, 400);
    }
    const suiteUserId = typeof body.suiteUserId === "string" ? body.suiteUserId.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const problems: Record<string, string> = {};
    if (!suiteUserId) problems.suiteUserId = "required — the Suite account id, not an email";
    if (suiteUserId.includes("@")) problems.suiteUserId = "that is an email; resolve it to a Suite id first";
    if (!opts.roles.includes(role as Role)) problems.role = `one of ${opts.roles.join(", ")}`;
    if (Object.keys(problems).length) {
      return json({ error: "Invalid grant", code: "validation", details: problems }, 400);
    }

    const row = await opts.store.grant({ suiteUserId, role, grantedBy: admin.id });
    return json(toPublic(row), 201);
  }

  /** For `[suiteUserId]/route.ts`. Reads the id from the last path segment. */
  async function DELETE(
    req: Request,
    ctx?: { params: Promise<{ suiteUserId: string }> | { suiteUserId: string } }
  ): Promise<Response> {
    const admin = await opts.isAdmin(req);
    if (!admin) return json({ error: "Only this app's admins can revoke access", code: "forbidden" }, 403);
    const params = ctx ? await ctx.params : undefined;
    const id =
      params?.suiteUserId ?? new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
    if (!id) return json({ error: "Suite account id required", code: "validation" }, 400);
    if (id === admin.id) {
      // Refusing this is not paternalism: an app whose last admin revoked
      // themselves needs a database console to recover.
      return json({ error: "You cannot revoke your own access", code: "conflict" }, 409);
    }
    const ok = await opts.store.revoke(id);
    if (!ok) return json({ error: "No such access row", code: "not_found" }, 404);
    return new Response(null, { status: 204 });
  }

  return { GET, POST, DELETE };
}
