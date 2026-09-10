# @stri/auth

STRI Suite authentication for consuming apps. Replaces the copy-pasted
`templates/stri-auth` files with a single updatable dependency: fixes ship by
bumping the version rather than editing every app.

## What it provides

| Import | Use |
|---|---|
| `@stri/auth` → `getUser()` | the signed-in user (server components / route handlers / actions) |
| `@stri/auth/middleware` → `middleware`, `defaultConfig` | the auth gate |
| `@stri/auth/callback` → `GET` | token-to-cookie exchange |
| `@stri/auth/signout` → `GET`, `POST` | sign out of app **and** Suite |

## Install

```jsonc
// package.json — pin a tag, never a moving branch
"dependencies": {
  "@stri/auth": "github:STRI-Research/stri-auth#v1.0.0"
}
```

```ts
// next.config.ts — the package ships TS source; Next transpiles it
const nextConfig = { transpilePackages: ["@stri/auth"] };
```

## Wire up (three shim files Next.js requires at fixed paths)

```ts
// src/middleware.ts
export { middleware } from "@stri/auth/middleware";
export { defaultConfig as config } from "@stri/auth/middleware";
```

If the app has routes that must stay public (mobile, cron, webhooks), define
your own `config` instead of re-exporting `defaultConfig`:

```ts
// src/middleware.ts (app with public routes)
export { middleware } from "@stri/auth/middleware";
export const config = {
  matcher: [
    "/((?!api/auth|m/|api/cron|_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
```

```ts
// src/app/api/auth/callback/route.ts
export { GET } from "@stri/auth/callback";
```

```ts
// src/app/api/auth/signout/route.ts
export { GET, POST } from "@stri/auth/signout";
```

## Env vars (set on the Vercel project)

| Var | Value |
|---|---|
| `STRI_SUITE_URL` | `https://stri-suite.vercel.app` |
| `STRI_APP_NAME` | must match the Suite `App.name` exactly |
| `STRI_AUTH_PUBLIC_KEY` | the Ed25519 public key |

## Updating

Bump the tag in `package.json`, `npm install`, redeploy. Changes are reviewed
in a normal PR — a bad release can't reach an app until its ref is bumped.

## Releasing a new version

1. Edit , bump  in .
2. Tag: .
3. Apps adopt by pointing their dependency at the new tag.

## App-to-app API keys (`@stri/auth/api`) — v1.1

Every STRI app exposes `/api/v1` to sibling apps behind per-consumer, scoped
API keys that the app issues from its own admin page. The design is in
STRISuite `docs/api/README.md`; the app specs are in `docs/api/*.yaml`.

| Import | Use |
|---|---|
| `@stri/auth/api` → `requireWorkload(req, store, { scope, actor })` | the gate every `/api/v1` route calls first |
| `@stri/auth/api` → `mintKey`, `hashKey`, `errors`, `apiError`, `page`, `encodeCursor`, `decodeCursor`, `pageLimit` | helpers |
| `@stri/auth/api/admin` → `createApiKeyHandlers({...})` | drop-in `GET|POST /api/v1/api-keys` and `DELETE /api/v1/api-keys/{id}` |

```ts
// src/lib/api-keys.ts — the app's adapter over its own ORM
import type { AdminKeyStore } from "@stri/auth/api/admin";
export const keyStore: AdminKeyStore = {
  findByHash: (hash) => db.query.apiKey.findFirst({ where: eq(apiKey.hash, hash) }),
  touch: (id) => db.update(apiKey).set({ lastUsedAt: new Date(), useCount: sql`use_count + 1` }).where(eq(apiKey.id, id)),
  list: () => db.select().from(apiKey).orderBy(desc(apiKey.createdAt)),
  create: (rec) => db.insert(apiKey).values(rec).returning().then(r => r[0]),
  revoke: async (id) => (await db.update(apiKey).set({ revokedAt: new Date() }).where(eq(apiKey.id, id)).returning()).length > 0,
};
```

```ts
// src/app/api/v1/machines/route.ts
import { requireWorkload, page } from "@stri/auth/api";
export async function GET(req: Request) {
  const caller = await requireWorkload(req, keyStore, { scope: "machines:read" });
  if (caller instanceof Response) return caller;
  // caller.consumer, caller.scopes, caller.actor (null unless X-STRI-Actor was forwarded)
  return Response.json(page(items, nextCursor));
}
```

Rules the module enforces: hash lookup only; revoked and expired keys are 401;
a key minted for one Vercel environment is 401 on any other; a missing scope
is 403 `insufficient_scope` with `required` and `granted` in `details`;
`X-STRI-Actor` is a Suite session JWT verified with the public key (its `app`
claim is ignored, its `sub` is the Suite account id); `actor: "required"`
refuses calls without one. Set `STRI_SUITE_API_KEY` (scope
`integrations:write`) to have mints and revocations recorded in the Suite's
integration registry; without it they still succeed.

**Remember to exclude `/api/v1` from the session middleware matcher** — these
routes authenticate themselves and must never redirect to the Suite.
