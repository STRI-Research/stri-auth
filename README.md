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

## Route-level authorization

`middleware` authenticates. It does not authorize. A valid `stri-session` gets a
caller past the gate; whether they may do the thing is each route's job.

The estate audit repeatedly finds handlers that resolve a caller and then never
look at it — `const caller = await getUser()` followed by nothing. `getUser()`
returns `StriUser | null`, so every call site has to remember the null check.
`requireCaller()` removes that branch entirely.

```ts
import { withCaller, requireRole, forbiddenResponse } from "@stri/auth/caller";

// Caller resolved before the handler runs; 401 answered consistently.
export const GET = withCaller(async (caller) => {
  return Response.json(await listFor(caller.id));
});

// Ownership check — the shape that stops IDOR.
export const DELETE = withCaller(async (caller, _req, { params }) => {
  const { id } = await params;
  const job = await load(id);
  if (job.ownerId !== caller.id) return forbiddenResponse("not your job");
  await remove(id);
  return new Response(null, { status: 204 });
});

// Role check. Throws ForbiddenError -> 403.
export const POST = withCaller(async () => {
  await requireRole("admin");
  ...
});
```

Because the caller is the handler's **first argument**, an unused-parameter lint
rule flags any handler that ignores it. That turns "someone forgot to authorize
this route" from a code-review question into a build failure.

### 401 vs 403

`unauthorizedResponse()` (401) means *re-authenticate*. `forbiddenResponse()`
(403) means *you are who you say you are and still may not do this*. Returning
401 for a permissions failure sends the client back through Suite and produces a
redirect loop.

### Reading the role

`requireRole()` reads `role` from the **token**, minted at sign-in and valid for
the session TTL. For a decision that must reflect a change made seconds ago — a
demotion, a revoked grant — read the role from your own database instead. Suite's
`app-login` does exactly that, deliberately.
