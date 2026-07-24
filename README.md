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

1. Edit `src/`, bump `version` in `package.json`.
2. Tag: `git tag v1.1.0 && git push origin v1.1.0`.
3. Apps adopt by pointing their dependency at the new tag.
