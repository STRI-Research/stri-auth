# STRI app rules

What every app in the STRI estate must be, and must never do.

These rules exist for one reason: **a solo-maintained estate of twenty apps only
stays maintainable if each app is small enough to hold in one head — or one
context window — at a time.** Every rule below is either a shape that keeps an
app that small, or scar tissue from something that has actually gone wrong here.

The reference implementation is **Machine Tracker**. When a rule is ambiguous,
read that repo: 13 tables, 24 API routes, one domain, one sentence of purpose.
It is the size an STRI app should be.

Version: 1.0.0 — 15 September 2026. Canonical copy: `@stri/auth/RULES.md`.
Check an app with `npx stri-conform`.

---

## Part 1 — The shape

Five rules. An app that breaks one of these is not a bad app; it is two apps.

### S1. One purpose, in one sentence

`PROJECT.md` opens with a single sentence naming what the app is for. Not a
paragraph, not a feature list. If the sentence needs an "and" joining two
unrelated nouns, that is two apps.

> Machine Tracker: *QR-code machine tracking for grounds teams — scan a
> machine's QR to run its pre-start check and report faults; admins track
> service history, fault history and check compliance.*

The test: could a new developer read that sentence and correctly predict
whether a given feature belongs in this app? If not, rewrite the sentence — or
accept that the app has lost its focus and needs splitting.

### S2. One front end, Next.js, App Router

One codebase, one framework. Not two frameworks, not a separate SPA calling a
separate API, not a static HTML app wrapped in a shell.

App Router specifically, because it hands a route a real Web `Request` and lets
it return a `Response` — which is what the auth and API-key layers are built
on. A Pages Router app needs a bespoke adapter at every boundary, and nobody
else in the estate has one to copy from.

### S3. One back end, one Postgres database, owned by this app alone

One Neon project per app. **No app ever reads another app's database.** Not with
a read-only role, not "just for a dashboard", not temporarily.

This is the rule most often broken by good intentions, and the one that costs
most. Job Board reads the Planner's Postgres directly with raw SQL today: it is
coupled to the Planner's table names and enum values, it selects the private
`absences.category` column the Planner's own UI hides behind a permission, and
a Planner schema change breaks it silently into sample data that looks like
real jobs. That is what "no API" costs, and it is why S5 exists.

### S4. Secured by STRI Suite auth, with every route gated

Two distinct obligations, and conflating them is the estate's most repeated bug:

1. **Authentication** — `@stri/auth/middleware`, wired at the three shim paths,
   gating everything except the documented exclusions (see N4).
2. **Authorization** — **every** API route that mutates, and every route that
   returns data not everyone may see, checks the caller's role or permission
   *in the route itself*.

`@stri/auth` middleware only authenticates. A valid `stri-session` cookie
passes it. Per-app roles are enforced only where each route checks them. The
Planner shipped ~25 routes that leaned on the middleware alone — delete and
edit by id with no ownership check, and `personId` trusted from the request
body. Anyone who could sign in could edit anyone's data.

### S5. One REST API at `/api/v1`, and only an app admin can mint a key

Everything another app needs crosses HTTP, described by an OpenAPI document in
the repo and served by the deployment that implements it.

Keys are minted by a **person holding this app's own admin role**, from this
app's own admin page. Never by a key — keys cannot mint keys. Never by an env
var shared between apps.

---

## Part 2 — The non-negotiables

The shape rules describe an app. These describe things that must never be true
of one. Each has happened here.

### N1. Identity is the Suite account id, never email

Key every local person row on `suite_user_id` (the JWT `sub`). Email is a
contact attribute and a one-time bootstrap matcher, nothing more. Email changes;
account ids do not, and an app keyed on email silently forks a person into two
when HR updates their surname.

### N2. Responses are DTOs, never database rows

Every `/api/v1` response goes through an explicit mapper. Never `return
Response.json(rows)`.

A consumer that starts depending on a column added for the UI is a consumer
broken by the next UI change. The mapper is also the only reliable place to keep
a sensitive column from leaving by accident — which is N3.

### N3. Sensitive data needs its own scope, and never rides along

A field that is gated in the UI is gated in the API, at the same granularity.
Special-category data under Article 9 — sickness, health — gets a *separate*
scope that is granted to almost nothing, and the general-purpose response
returns a neutral form or nothing at all.

The Planner's absence model is the pattern to copy: `absences:read` returns
`away | remote | offsite`; the category and notes need `absences:read-detail`;
the category-to-state mapping happens server-side so the sensitive value never
reaches the general endpoint. Trial cost goes further — it has no API field at
all, at any scope.

### N4. The auth middleware's exclusion list is a closed set, and every entry is justified in a comment

Excluding a path from the middleware removes authentication from it. The only
acceptable exclusions:

| Path | Why |
|---|---|
| `api/auth/` | The callback that establishes the session. |
| `api/v1/` | Machine callers authenticate per-request with a bearer key; a redirect to a login page would be nonsense. **Every route under it must authenticate itself.** |
| `api/cron/` | Vercel cron, which self-authenticates on `CRON_SECRET`, fail-closed. |
| Static assets, `sw.js`, `manifest.webmanifest`, `offline.html` | No user data, and a session-expiry redirect would poison the service worker. |

Anything else needs a written reason next to it. A QR or token route that must
be reachable unauthenticated is a real case — Machine Tracker has one — but the
token must then *be* the authorisation, scoped and expiring, and that must be
said out loud in the code.

### N5. No app is reachable without auth by any route

Concretely, all of these are prohibited:

- A `vercel` branch, or any long-lived branch, carrying a pre-auth copy of the app.
- A Vercel protection-bypass token used as an access mechanism.
- Uploaded files served from a path the middleware does not cover.
- Directory indexing on any upload location.

All four have happened. Eight apps carried a pre-auth `vercel` branch, and twice
the real app was living on it rather than on `main`. The legacy Planner stayed
reachable for days after its Suite tile was removed, because supervisors had a
bookmarked bypass-token cookie — de-listing an app from the Suite does not stop
it; revoking and rotating its bypass tokens does. And STRIlive gated its pages
but not its uploads, leaving HR PDFs fetchable with directory indexing on.

### N6. An API key is hashed at rest, shown once, and bound to one environment

Only the SHA-256 hash is stored. The secret appears in the mint response and
nowhere else, ever. A key is minted for `production`, `preview` or
`development` and refuses to work anywhere else, so preview code holding a
preview key still cannot reach production data.

Scopes are fixed at mint time and can never widen. A consumer needing more asks
for a new key.

### N7. Production deploys from `main`

Cut work on a short-lived branch, verify the Vercel preview, fast-forward merge.
No app deploys production from anything else.

### N8. Schema changes never run automatically against production

No boot hook, no preview deployment, no CI step applies DDL to a production
database. Additive DDL applied by hand, with the migration committed, is the
reliable path.

ART learned this the hard way: pushing a schema branch ran its DDL on
production, via a boot hook against a shared preview database.

### N9. The database is in the nightly backup

An app with a database adds it to `backup-config.json` in STRISuite and sets its
`*_DB_URL` secret **in the same change that creates it**. As of 7 September
2026, 8 of 16 Neon projects were not backed up, and nobody had noticed because
nothing fails when a backup does not exist.

### N10. Secrets are never committed, and never shared between apps

No `.env` in git. One credential per consumer per provider, revocable on its
own. The estate has three shared machine credentials predating this rule, one of
which broke the day a copy of it was rotated somewhere else.

### N11. The app registry is the truth about status

`App.lifecycle` in the Suite database, set through registration and promoted by
an admin. Not a markdown table, not a comment. Status tracked in a hand-edited
file is status that is already wrong.

---

### One exemption: the auth broker

The STRI Suite issues the sessions every other app verifies, so it cannot depend
on `@stri/auth` or carry the three consumer shims — requiring it to would be
requiring it to authenticate against itself. It declares this in its
package.json:

```json
"striConform": { "role": "broker" }
```

That exempts exactly three checks (the `@stri/auth` dependency, the middleware's
use of the package, and the callback and sign-out shims). **Every other rule
still applies to the Suite**, including the API surface — it holds the estate's
integration registry and its own alert keys, so it needs `/api/v1` and an
`api_key` table as much as anything else does. There is no second exemption, and
adding one is a change to this document, not to an app.

## Part 3 — The complexity ceiling

Sam's framing: *the most complicated app should not get more complex than
Machine Tracker.* Machine Tracker, measured:

| | Machine Tracker |
|---|---|
| Source | 375 KB |
| Tables | 13 |
| API routes | 24 (21 of them `/api/v1`) |
| Top-level sections | 6 |

The ceiling is **qualitative first**: one domain, one sentence, and the S1 test
— can a reader predict from the sentence whether a feature belongs?

The numbers below are **tripwires, not gates**. Crossing one does not make an
app broken; it means the app must justify itself or be split, in writing, in
`PROJECT.md`. They sit at roughly three times Machine Tracker, so a genuinely
richer domain like ART or the SOP tool passes without argument and a sprawl like
the Planner cannot.

| Tripwire | Limit |
|---|---|
| Tables in one database | 40 |
| Source size | 1.5 MB |
| Top-level UI sections | 10 |

Two rules of thumb that catch sprawl earlier than any number:

- **A feature whose data has no foreign key to the app's core noun is probably
  in the wrong app.** The Planner's spray, training and weather tables reference
  `people` and nothing else about planning.
- **If a feature would still make sense with the rest of the app deleted, it is
  a separate app.** Weather widgets make perfect sense without a planner.

---

## Part 4 — What an app must contain

The mechanically checkable list. `npx stri-conform` verifies these.

```
PROJECT.md                              one-sentence purpose on the first content line
SPEC.md                                 the full specification
README.md                               how to run it
src/middleware.ts                       re-exports @stri/auth/middleware; matcher excludes api/auth/ and api/v1/
src/app/api/auth/callback/route.ts      re-exports @stri/auth/callback
src/app/api/auth/signout/route.ts       re-exports @stri/auth/signout
src/lib/caller.ts (or equivalent)       resolves the Suite user to a local row + role
src/db/schema.ts                        includes api_key and api_idempotency
src/lib/api/scopes.ts                   the declared scope list
src/lib/api-keys.ts                     the keyStore adapter
src/lib/api/key-handlers.ts             createApiKeyHandlers with a local-admin isAdmin
src/app/api/v1/health/route.ts          public liveness
src/app/api/v1/me/route.ts              key introspection
src/app/api/v1/openapi.json/route.ts    serves the committed spec
src/app/api/v1/api-keys/route.ts        list + mint, session-authenticated, admin only
src/app/api/v1/api-keys/[id]/route.ts   revoke
docs/api/openapi.yaml                   the contract
docs/api/openapi.json                   bundled, dereferenced, served by the app
an admin page for API access             e.g. src/app/(admin)/settings/api/page.tsx
```

---

## Part 5 — Applying this to an app that does not conform

Never a hard move. The method, in order:

1. **Duplicate** the feature and its data on the target app. Leave it in place.
2. **Switch** the connection to the target and watch.
3. **Keep the rollback** available while it beds in.
4. **Remove** it from the original only once the new path is proven.

Expect drift between the two sides during the overlap and plan to reconcile it.
A live app used by the whole crew cannot be cut over in one step; the switch
itself should be the only risky moment.

---

## Changing these rules

Edit `RULES.md` in `stri-auth`, bump the package version, and let apps pick it
up with `npm update @stri/auth`. Rules live with the package every app already
depends on precisely so there is one copy, versioned, and no app can hold a
private variant.
