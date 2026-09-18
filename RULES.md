# STRI app rules

What every app in the STRI estate must be, and must never do.

These rules exist for one reason: **a solo-maintained estate of twenty apps only
stays maintainable if each app is small enough to hold in one head — or one
context window — at a time.** Every rule below is either a shape that keeps an
app that small, or scar tissue from something that has actually gone wrong here.

The reference implementation is **Machine Tracker**. When a rule is ambiguous,
read that repo: 13 tables, 24 API routes, one domain, one sentence of purpose.
It is the size an STRI app should be.

Version: 2.0.0 — 18 September 2026. Canonical copy: `@stri/auth/RULES.md`.
Check an app with `npx stri-conform`.

> **What changed in 2.0.** The rules are now organised by **component** rather
> than by concern. An app declares which components it has; the checker enforces
> those, and flags a component that is present but undeclared. Version 1 covered
> sign-in, the database and the API well, and said nothing about object storage,
> permissions, scheduled work, audit or outbound comms — so three apps could
> store files three different ways without breaking a single rule. Nothing from
> version 1 is dropped; the rule IDs are unchanged. The new components ship as
> **warnings** until each app has converted (see "Severity", below).

---

## Part 1 — Components

An app is made of components. Not every app has every component. **Every app
that has one does it the same way.**

| # | Component | Every app? | Rules | Shared code |
|---|---|---|---|---|
| 1 | Purpose and shape | yes | S1 | — |
| 2 | Front end | usually | S2, D1 | STRIUX design system |
| 3 | Database | usually | S3, N8, N9 | — |
| 4 | Sign-in | yes | S4a, N4, N5 | `@stri/auth/middleware` |
| 5 | **User permissions** | when people differ | **P1–P4** | `@stri/auth/permissions` |
| 6 | **Object storage** | when files are held | **O1–O4** | `@stri/storage` |
| 7 | API | when another app reads it | S5, N2, N3, N6 | `@stri/auth/api` |
| 8 | **Background work** | when something runs unattended | **B1–B2** | — |
| 9 | **Audit log** | when actions need attributing | **A1** | — |
| 10 | **Outbound comms** | when the app tells people things | **M1** | Suite `/api/v1/alerts` |
| 11 | **Model access** | when it calls an LLM | **X1–X2** | — |
| 12 | Secrets and config | yes | N10, **K1** | — |
| 13 | Deploy and registry | yes | N7, N11 | — |
| 14 | **Data retention** | when it holds personal data | **R1** | — |

### Declaring components

In `package.json`, beside the existing `role`:

```json
"striConform": {
  "components": ["front-end", "database", "sign-in", "permissions", "api"]
}
```

The checker then enforces exactly those, and — the half that matters — **flags
what it finds that you did not declare**. A `BLOB_READ_WRITE_TOKEN` in the
environment with no `storage` component is either an undeclared component or a
live credential nobody is using, and both deserve an answer. Undeclared is not
a way out of a rule; it is a finding of its own.

An app that declares nothing is treated as declaring everything the checker can
see. Declaration is how you say "this app deliberately has no X", not how you
avoid being checked.

### Components depend on each other

```
api ──▶ permissions ──▶ sign-in
storage ─────────────▶ sign-in
background ──────────▶ (its own credential, never a person's)
audit ───────────────▶ permissions
```

- **API requires permissions.** A key can act for a person. An app that cannot
  say what that person may do has handed the decision to the key.
- **Permissions require sign-in.** Obviously, but it is the reason permissions
  is not simply "a roles table": it is keyed on the identity sign-in issues.
- **Storage requires sign-in.** A signed URL is worthless if anyone can ask for
  one.
- **Audit requires permissions**, because "who did this" is only meaningful if
  the app knows who may.

### Severity

New in 2.0 and **warnings** until an app converts: P1–P4, O1–O4, B1–B2, A1, M1,
X1–X2, K1, R1, D1. A warning names the gap and the date it was raised; it does
not fail the run. Each becomes a failure for an app the day that app declares
the component and converts — the point of the ramp is that a checker red
everywhere is a checker nobody reads.

Everything carried over from version 1 keeps its current severity.

---

## Part 2 — The components

### 1. Purpose and shape — *every app*

#### S1. One purpose, in one sentence

`PROJECT.md` opens with a single sentence naming what the app is for. Not a
paragraph, not a feature list. If the sentence needs an "and" joining two
unrelated nouns, that is two apps.

> Machine Tracker: *QR-code machine tracking for grounds teams — scan a
> machine's QR to run its pre-start check and report faults; admins track
> service history, fault history and check compliance.*

The test: could a new developer read that sentence and correctly predict
whether a given feature belongs in this app? If not, rewrite the sentence — or
accept that the app has lost its focus and needs splitting.

---

### 2. Front end

#### S2. One front end, Next.js, App Router

One codebase, one framework. Not two frameworks, not a separate SPA calling a
separate API, not a static HTML app wrapped in a shell.

App Router specifically, because it hands a route a real Web `Request` and lets
it return a `Response` — which is what the auth and API-key layers are built
on. A Pages Router app needs a bespoke adapter at every boundary, and nobody
else in the estate has one to copy from.

#### D1. The design system is consumed, never forked *(warning)*

Shared material, per-app character through the theme layer. Apps should not look
identical — they should look related. Copying a component into an app and
editing it there is how they stop being related, one fix at a time.

---

### 3. Database

#### S3. One back end, one Postgres database, owned by this app alone

One Neon project per app. **No app ever reads another app's database.** Not with
a read-only role, not "just for a dashboard", not temporarily.

This is the rule most often broken by good intentions, and the one that costs
most. Job Board read the Planner's Postgres directly with raw SQL: coupled to
the Planner's table names and enum values, selecting the private
`absences.category` column the Planner's own UI hides behind a permission, and
a Planner schema change would have broken it silently into sample data that
looked like real jobs. That is what "no API" costs, and it is why the API
component exists.

#### N8. Schema changes never run automatically against production

No boot hook, no preview deployment, no CI step applies DDL to a production
database. Additive DDL applied by hand, with the migration committed, is the
reliable path.

ART learned this the hard way: pushing a schema branch ran its DDL on
production, via a boot hook against a shared preview database.

#### N9. The database is in the nightly backup

An app with a database adds it to `backup-config.json` in STRISuite and sets its
`*_DB_URL` secret **in the same change that creates it**. As of 7 September
2026, 8 of 16 Neon projects were not backed up, and nobody had noticed because
nothing fails when a backup does not exist.

---

### 4. Sign-in — *every app*

#### S4a. Authentication is `@stri/auth`, wired at the three shim paths

`src/middleware.ts`, `src/app/api/auth/callback/route.ts`,
`src/app/api/auth/signout/route.ts`. The Suite issues the session; the app
verifies it. No app implements sign-in itself.

The authorization half of old S4 now lives in the permissions component as P3 —
the split is deliberate. Conflating them is the estate's most repeated bug.

#### N4. The middleware's exclusion list is a closed set, and every entry is justified in a comment

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

#### N5. No app is reachable without auth by any route

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

---

### 5. User permissions

*Required when not everyone who can open the app may do everything in it, and
by dependency whenever the app has an API.*

#### P1. Access is a row in this app's own table, keyed on the Suite account id *(warning)*

```sql
create table app_access (
  suite_user_id text primary key,          -- the JWT `sub`. Never an email.
  role          text not null,             -- one of this app's declared roles
  granted_by    text,                      -- the admin's suite_user_id
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
```

Every app answers "may this person do this?" from its own table, in the same
shape, with the same key. Today five apps answer it five ways — a role column on
a people table, a join table of roles, a single string on an app_user row, a
Suite-role check with no table at all — and the differences are historical
rather than meaningful.

Per-person exceptions, where an app needs them, are one more table of
`(suite_user_id, capability)` and nothing else.

`@stri/auth/permissions` provides the schema, the resolver and the grant page.
Use it rather than writing a fifth variant.

#### P2. The permissions table holds no display identity *(warning)*

No name, no display name, no email, no avatar. Those are read from the Suite
directory (`GET /api/v1/users/{id}`), cached in memory for minutes at most,
never in a column.

A name cached in an app is a name that goes stale silently, and a name written
back from a session token is worse: the Planner overwrote two people's email
addresses in production that way, because a test token carried a fake address
and the app treated the session as authoritative for contact details. The Suite
is the only place a person's display identity is edited.

This does **not** mean an app cannot have a person table. A domain person row —
someone who is scheduled, assessed or rostered, who may have no Suite account at
all — is a different thing and keeps whatever columns it needs. The Planner has
22 people and 18 accounts, and that is correct. The rule governs the
**permissions** path: what the app consults to decide what somebody may do.

#### P3. Authorization is checked in the route, not by the middleware *(carried from S4)*

**Every** API route that mutates, and every route that returns data not everyone
may see, checks the caller's role or permission *in the route itself*.

`@stri/auth` middleware only authenticates. A valid `stri-session` cookie
passes it. The Planner shipped ~25 routes that leaned on the middleware alone —
delete and edit by id with no ownership check, and `personId` trusted from the
request body. Anyone who could sign in could edit anyone's data. ART shipped 41
more of the same, found in the 17 September audit.

The role is read from the app's own table on every request, never from the JWT:
a demoted admin loses the page on their next request, not at their next login.

#### P4. Access is granted by a person, from a page in the app *(warning)*

Not by editing the database, not by an environment variable, not by a
first-come-first-served bootstrap that quietly makes whoever signs in first an
admin. An app with permissions has a page where an admin grants and revokes
them, and the grant records who made it.

Machine Tracker's roles could only be changed with SQL until 18 September 2026,
which is why its owner sat at `field` for a month without anyone noticing he
could not reach his own app's admin.

---

### 6. Object storage

*Required when the app holds files: uploads, photographs, generated documents.*

#### O1. Private by default, reached through a short-lived signed URL *(warning)*

No public bucket, no public blob URL, no "unguessable" path standing in for
access control. The app checks the caller, then mints a signed URL measured in
seconds or minutes.

Machine Tracker's invoice and fault-photo URLs are public today, and since its
API shipped they are also returned over `/api/v1` — so a scoped key that may
read a machine also hands out permanent public links to its paperwork. That is
the whole failure in one sentence: the gate was on the record, not on the file.

#### O2. The database stores a pathname, never a URL *(warning)*

A row holds the object's key inside the store. The URL is constructed at read
time by whatever the storage facade currently points at.

A URL in a column is a vendor migration that has to touch every row. ART's
imagery tables store pathnames and its move from Vercel Blob to Cloudflare R2
needed no data change at all; its older `evidence_file` table stores the URL
beside the key, and moving that one is a data migration rather than a config
change.

#### O3. One facade module, one vendor decision *(warning)*

`src/lib/storage.ts` (or `@stri/storage`) is the only module that names the
vendor. Reads fall back to the other store while a migration is in flight, which
is what makes a store move a parallel run rather than a cutover.

#### O4. No directory indexing, ever *(warning)*

On any upload location, under any vendor. STRIlive served an indexable directory
of HR PDFs behind a gated app.

---

### 7. API

*Required when another app needs this app's data. Requires the permissions
component.*

#### S5. One REST API at `/api/v1`, and only an app admin can mint a key

Everything another app needs crosses HTTP, described by an OpenAPI document in
the repo and served by the deployment that implements it.

Keys are minted by a **person holding this app's own admin role**, from this
app's own admin page. Never by a key — keys cannot mint keys. Never by an env
var shared between apps.

#### N2. Responses are DTOs, never database rows

Every `/api/v1` response goes through an explicit mapper. Never `return
Response.json(rows)`.

A consumer that starts depending on a column added for the UI is a consumer
broken by the next UI change. The mapper is also the only reliable place to keep
a sensitive column from leaving by accident — which is N3.

#### N3. Sensitive data needs its own scope, and never rides along

A field that is gated in the UI is gated in the API, at the same granularity.
Special-category data under Article 9 — sickness, health — gets a *separate*
scope that is granted to almost nothing, and the general-purpose response
returns a neutral form or nothing at all.

The Planner's absence model is the pattern to copy: `absences:read` returns
`away | remote | offsite`; the category and notes need `absences:read-detail`;
the category-to-state mapping happens server-side so the sensitive value never
reaches the general endpoint. Trial cost goes further — it has no API field at
all, at any scope.

#### N6. An API key is hashed at rest, shown once, and bound to one environment

Only the SHA-256 hash is stored. The secret appears in the mint response and
nowhere else, ever. A key is minted for `production`, `preview` or
`development` and refuses to work anywhere else, so preview code holding a
preview key still cannot reach production data.

Scopes are fixed at mint time and can never widen. A consumer needing more asks
for a new key.

**Acting for a person.** A key identifies an app, never a person. Where a route
records something on somebody's behalf, the caller forwards that person's Suite
session in `X-STRI-Actor` and the app verifies the signature. ART posted
read-and-understood records to the SOP tool for a month by *asserting* who had
read them; on a compliance record that is the difference between evidence and a
claim.

---

### 8. Background work

*Required when something runs without a person present: cron, queues, webhooks.*

#### B1. Unattended work authenticates itself, fail-closed *(warning)*

A cron route checks `CRON_SECRET` and **refuses when the variable is missing**,
rather than treating absence as permission. A webhook verifies its signature.
Neither ever runs on "it is only called by the platform".

Both of the Planner's cron routes failed open on a missing secret until 17
September 2026: unset the variable and the endpoint was public.

#### B2. Unattended work is safe to run twice *(warning)*

Idempotent, or guarded by a claim. Retries happen, schedules overlap, and a job
that double-sends is a job that will.

---

### 9. Audit log

*Required when the app records actions that somebody may later be asked to
account for.*

#### A1. One append-only log: who, what, when, and on whose behalf *(warning)*

One table, one writer, never edited in place. A row names the **person** (Suite
account id), the **action**, the **target**, and — when a machine caller was
involved — the **app that carried it**. "Sam, via the deploy skill" is the pair
worth keeping; either half alone is a guess.

Four apps have four audit designs today, and two of them silently swallow write
failures, which makes the log evidence of nothing.

---

### 10. Outbound comms

*Required when the app tells people things: notifications, alerts, email.*

#### M1. People are reached through the Suite, not by each app *(warning)*

`POST /api/v1/alerts` on the Suite, with a key carrying `alerts:send`. The Suite
holds the accounts, the devices and the inbox; an app that mails people directly
needs its own address list, which is a second directory going stale.

An app-specific channel — a Slack app for its own team, say — is legitimate, and
belongs in its component declaration.

---

### 11. Model access

*Required when the app calls an LLM.*

#### X1. The model sees no special-category data *(warning)*

No sickness, health, or anything else under Article 9. Where an app extracts
from documents that may contain it, the extraction is scoped to the fields it
needs and the rest is not sent.

#### X2. The model proposes; a person decides *(warning)*

Model output lands in a queue a human confirms, and the record says it was
AI-assisted. The SOP tool's COSHH extraction is the pattern: every extracted
fact is `extracted` until somebody verifies it, and correcting one requires a
reason.

---

### 12. Secrets and config — *every app*

#### N10. Secrets are never committed, and never shared between apps

No `.env` in git. One credential per consumer per provider, revocable on its
own. The estate had three shared machine credentials predating this rule, one of
which broke the day a copy of it was rotated somewhere else, and one of which —
`STRI_API_TOKEN` — could register an app *and* create an account with a role
while living in a team-wide variable every project inherited.

#### K1. A secret is typed as a secret *(warning)*

On Vercel, `sensitive` rather than `encrypted`: an `encrypted` value can be read
back from the dashboard and the API, and Vercel's own scanner flags it. Eleven
variables on the Planner alone are typed the readable way.

---

### 13. Deploy and registry — *every app*

#### N7. Production deploys from `main`

Cut work on a short-lived branch, verify the Vercel preview, fast-forward merge.
No app deploys production from anything else.

#### N11. The app registry is the truth about status

`App.lifecycle` in the Suite database, set through registration and promoted by
an admin. Not a markdown table, not a comment. Status tracked in a hand-edited
file is status that is already wrong.

---

### 14. Data retention

*Required when the app holds personal data.*

#### R1. Say how long, and have a way to delete *(warning)*

`PROJECT.md` states what personal data the app holds and how long it keeps it,
and the app has a path to delete one person's data without a database console.

Not a compliance ornament: a leaver's data sitting in nine apps with no stated
lifetime is nine copies nobody can account for.

---

## Part 3 — The complexity ceiling

The standard: *the most complicated app should not get more complex than
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

## Part 4 — What an app must contain, by component

The mechanically checkable list. `npx stri-conform` verifies these.

**Every app**

```
PROJECT.md                              one-sentence purpose on the first content line
SPEC.md                                 the full specification
README.md                               how to run it
package.json                            striConform.components declares what this app has
```

**Sign-in**

```
src/middleware.ts                       re-exports @stri/auth/middleware; matcher excludes api/auth/ and api/v1/
src/app/api/auth/callback/route.ts      re-exports @stri/auth/callback
src/app/api/auth/signout/route.ts       re-exports @stri/auth/signout
```

**Permissions**

```
src/lib/permissions.ts (or caller.ts)   resolves the Suite user to this app's role
src/db/schema.ts                        includes app_access, keyed on suite_user_id
an admin page for access                grant and revoke, recording who granted
```

**Storage**

```
src/lib/storage.ts                      the only module naming the vendor
```

**API**

```
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
an admin page for API access            e.g. src/app/(admin)/settings/api/page.tsx
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

This is how a component is adopted, too: add the new table beside the old
column, flip the one resolver that reads it, then drop the old column. Every app
already funnels authorization through a single resolver, which is what makes the
permissions component a three-step change rather than a rewrite.

---

### One exemption: the auth broker

The STRI Suite issues the sessions every other app verifies, so it cannot depend
on `@stri/auth` for sign-in or carry the three consumer shims — requiring it to
would be requiring it to authenticate against itself. It declares this in its
package.json:

```json
"striConform": { "role": "broker" }
```

That exempts exactly three checks (the `@stri/auth` dependency, the middleware's
use of the package, and the callback and sign-out shims), and the permissions
component, because the Suite's `User` table *is* the directory every other app's
permissions point at. **Every other rule still applies to the Suite**, including
the API surface — it holds the estate's integration registry and its own alert
keys, so it needs `/api/v1` and a key table as much as anything else does. There
is no second exemption, and adding one is a change to this document, not to an
app.

---

## Changing these rules

Edit `RULES.md` in `stri-auth`, bump the package version, and let apps pick it
up with `npm update @stri/auth`. Rules live with the package every app already
depends on precisely so there is one copy, versioned, and no app can hold a
private variant.
