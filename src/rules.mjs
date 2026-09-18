/**
 * The STRI app rules, as data.
 *
 * `RULES.md` is the prose. This is the same ruleset in a form a program can
 * read, so the checker in `conform.ts` and the document cannot drift: every
 * rule here has an id that appears in RULES.md, and `stri-conform` reports
 * against these ids.
 *
 * Severity is the whole point of the split:
 *   - `must`   a conformance failure. Non-zero exit. Fix it or the app is
 *              outside the estate's rules.
 *   - `should` a tripwire, or a rule still ramping in. Reported, does not fail
 *              the run. Crossing one means justify it in PROJECT.md or split
 *              the app — a judgement for a person, not a build step.
 *
 * Every rule also names the `component` it belongs to. An app declares its
 * components in package.json (`striConform.components`); the checker enforces
 * the declared ones and flags a component it can see but was not told about.
 * That is what lets "not every app has object storage" coexist with "every app
 * that has it does it the same way".
 *
 * Rules added in 2.0 carry `since: "2.0.0"` and severity `should`: they are
 * warnings until each app converts. A checker that is red everywhere is a
 * checker nobody reads.
 */


export const RULES_VERSION = "2.0.0";

/**
 * Each rule: `{ id, title, severity, because }`.
 *   id       — S* shape, N* non-negotiable, C* complexity ceiling.
 *              The same ids appear in RULES.md.
 *   severity — "must" fails a run; "should" is a tripwire.
 *   because  — printed with a failure, so the fix is obvious.
 */
export const RULES = [
  // ── Shape ───────────────────────────────────────────────────────────────
  {
    id: "S1",
    title: "One purpose, stated in one sentence at the top of PROJECT.md",
    severity: "must",
    because:
      "If the sentence needs an 'and' joining two unrelated nouns, the repo is two apps. The sentence is also the test for whether a new feature belongs.",
  },
  {
    id: "S2",
    title: "One front end: Next.js App Router",
    severity: "must",
    because:
      "App Router hands a route a real Web Request and returns a Response, which is what the auth and API-key layers are built on. Pages Router needs a bespoke adapter at every boundary.",
  },
  {
    id: "S3",
    title: "One Postgres database, owned by this app alone",
    severity: "must",
    because:
      "Reading another app's database couples you to its table names and its private columns. Job Board reads the Planner's absences.category — a column the Planner's own UI hides behind a permission.",
  },
  {
    id: "S4",
    title: "Suite auth on the app, and an authorization check inside every route",
    severity: "must",
    because:
      "The middleware only authenticates. A valid session passes it. The Planner shipped ~25 routes that leaned on the middleware alone, editable by anyone who could sign in.",
  },
  {
    id: "S5",
    title: "One REST API at /api/v1, keys minted only by a local admin",
    severity: "must",
    because:
      "It is the only way another app may read this one. Keys cannot mint keys, and a shared env-var credential is not a key.",
  },

  // ── Non-negotiables ─────────────────────────────────────────────────────
  {
    id: "N1",
    title: "Identity keyed on the Suite account id, never email",
    severity: "must",
    because:
      "Email changes; account ids do not. An app keyed on email forks one person into two the day HR updates a surname.",
  },
  {
    id: "N2",
    title: "API responses are DTOs, never database rows",
    severity: "must",
    because:
      "A consumer depending on a column added for the UI breaks on the next UI change. The mapper is also the only reliable place to stop a sensitive column leaving.",
  },
  {
    id: "N3",
    title: "Sensitive data has its own scope and never rides along",
    severity: "must",
    because:
      "A field gated in the UI is gated in the API at the same granularity. Article 9 health data gets a separate scope granted to almost nothing.",
  },
  {
    id: "N4",
    title: "The middleware exclusion list is a closed, justified set",
    severity: "must",
    because:
      "Excluding a path removes authentication from it. Only api/auth/, api/v1/, api/cron/ and static assets qualify; anything else needs a written reason beside it.",
  },
  {
    id: "N5",
    title: "No route, branch, bypass token or upload path reaches the app unauthenticated",
    severity: "must",
    because:
      "Eight apps carried a pre-auth 'vercel' branch. The legacy Planner stayed reachable for days on a bookmarked bypass cookie. STRIlive gated pages but not uploads, leaving HR PDFs fetchable.",
  },
  {
    id: "N6",
    title: "Keys are hashed at rest, shown once, bound to one environment",
    severity: "must",
    because:
      "Preview code holding a preview key still cannot reach production data. Scopes are fixed at mint time and can never widen.",
  },
  {
    id: "N7",
    title: "Production deploys from main",
    severity: "must",
    because:
      "A long-lived side branch carrying the real app is how an app ends up deployed twice, once without auth.",
  },
  {
    id: "N8",
    title: "No schema change runs automatically against production",
    severity: "must",
    because:
      "ART's boot hook ran a schema branch's DDL on production against a shared preview database.",
  },
  {
    id: "N9",
    title: "The database is in the nightly backup",
    severity: "must",
    because:
      "Nothing fails when a backup does not exist. 8 of 16 Neon projects were unbacked and nobody had noticed.",
  },
  {
    id: "N10",
    title: "No secret in git, and no credential shared between apps",
    severity: "must",
    because:
      "One shared machine credential broke the estate the day a second copy of it was rotated elsewhere.",
  },
  {
    id: "N11",
    title: "App status lives in the Suite registry, not in a file",
    severity: "should",
    because:
      "Status tracked in a hand-edited markdown table is status that is already wrong.",
  },

  // ── Complexity ceiling ──────────────────────────────────────────────────
  {
    id: "C1",
    title: "At most 40 tables in the app's database",
    severity: "should",
    because:
      "Three times Machine Tracker's 13. Past this an app stops fitting in one context window, and an LLM maintaining it starts guessing.",
  },
  {
    id: "C2",
    title: "At most 1.5 MB of application source",
    severity: "should",
    because:
      "Three times Machine Tracker's 375 KB. The ceiling is how much a maintainer — human or model — can hold at once.",
  },
  {
    id: "C3",
    title: "At most 10 top-level UI sections",
    severity: "should",
    because:
      "A nav with twelve entries is a description of twelve jobs, and S1 says an app has one.",
  },

  // ── User permissions (2.0) ──────────────────────────────────────────────
  {
    id: "P1",
    title: "Access is a row in this app's own table, keyed on the Suite account id",
    severity: "should",
    since: "2.0.0",
    component: "permissions",
    because:
      "Five apps answer 'may this person do this?' five ways today and the differences are historical, not meaningful. One shape, one key: app_access(suite_user_id, role, granted_by, granted_at, revoked_at).",
  },
  {
    id: "P2",
    title: "The permissions table holds no name, email or avatar",
    severity: "should",
    since: "2.0.0",
    component: "permissions",
    because:
      "Display identity is read from the Suite directory, never cached in a column. A name written back from a session token overwrote two people's email addresses in the Planner's production database.",
  },
  {
    id: "P3",
    title: "Authorization is checked in the route, from the app's own table",
    severity: "must",
    component: "permissions",
    because:
      "The middleware only authenticates. The Planner shipped ~25 ungated routes and ART 41 more. The role is read per request, so a demoted admin loses the page on their next request rather than at their next login.",
  },
  {
    id: "P4",
    title: "Access is granted by a person, from a page in the app",
    severity: "should",
    since: "2.0.0",
    component: "permissions",
    because:
      "Not by editing the database, not by an env var, not by making whoever signs in first an admin. Machine Tracker's roles could only be changed with SQL until 18 Sep 2026, so its owner sat at 'field' for a month.",
  },

  // ── Object storage (2.0) ────────────────────────────────────────────────
  {
    id: "O1",
    title: "Files are private, reached through a short-lived signed URL",
    severity: "should",
    since: "2.0.0",
    component: "storage",
    because:
      "Machine Tracker's invoice and fault-photo URLs are public, and since its API shipped a scoped key also hands them out. The gate was on the record, not on the file.",
  },
  {
    id: "O2",
    title: "The database stores an object pathname, never a URL",
    severity: "should",
    since: "2.0.0",
    component: "storage",
    because:
      "A URL in a column is a vendor migration that touches every row. ART's imagery tables store pathnames and moved to R2 with no data change; its evidence_file table stores URLs and cannot.",
  },
  {
    id: "O3",
    title: "One facade module names the vendor",
    severity: "should",
    since: "2.0.0",
    component: "storage",
    because:
      "Reads fall back to the other store while a migration is in flight, which is what makes a store move a parallel run rather than a cutover.",
  },
  {
    id: "O4",
    title: "No directory indexing on any upload location",
    severity: "should",
    since: "2.0.0",
    component: "storage",
    because:
      "STRIlive served an indexable directory of HR PDFs from behind a gated app.",
  },

  // ── Background work (2.0) ───────────────────────────────────────────────
  {
    id: "B1",
    title: "Unattended work authenticates itself, fail-closed",
    severity: "should",
    since: "2.0.0",
    component: "background",
    because:
      "Both Planner cron routes failed open on a missing CRON_SECRET until 17 Sep 2026: unset the variable and the endpoint was public.",
  },
  {
    id: "B2",
    title: "Unattended work is safe to run twice",
    severity: "should",
    since: "2.0.0",
    component: "background",
    because:
      "Retries happen and schedules overlap. A job that double-sends is a job that will.",
  },

  // ── Audit (2.0) ─────────────────────────────────────────────────────────
  {
    id: "A1",
    title: "One append-only audit log naming the person, the action and the app that carried it",
    severity: "should",
    since: "2.0.0",
    component: "audit",
    because:
      "Four apps have four audit designs and two swallow write failures, which makes the log evidence of nothing. 'Sam, via the deploy skill' is the pair worth keeping.",
  },

  // ── Outbound comms (2.0) ────────────────────────────────────────────────
  {
    id: "M1",
    title: "People are reached through the Suite alert channel, not a per-app mailer",
    severity: "should",
    since: "2.0.0",
    component: "comms",
    because:
      "The Suite holds the accounts, the devices and the inbox. An app that mails people directly needs its own address list, which is a second directory going stale.",
  },

  // ── Model access (2.0) ──────────────────────────────────────────────────
  {
    id: "X1",
    title: "No special-category data is sent to a model",
    severity: "should",
    since: "2.0.0",
    component: "model",
    because:
      "Article 9 data — sickness, health — does not leave the app. Extraction is scoped to the fields it needs.",
  },
  {
    id: "X2",
    title: "The model proposes; a person decides",
    severity: "should",
    since: "2.0.0",
    component: "model",
    because:
      "Output lands in a queue a human confirms, and the record says it was AI-assisted. The SOP tool's COSHH extraction is the pattern.",
  },

  // ── Secrets typing (2.0) ────────────────────────────────────────────────
  {
    id: "K1",
    title: "A secret is typed as a secret on the platform",
    severity: "should",
    since: "2.0.0",
    component: "secrets",
    because:
      "On Vercel, `sensitive` rather than `encrypted`: an encrypted value can be read back from the dashboard and the API, and Vercel's own scanner flags it. Eleven variables on the Planner are typed the readable way.",
  },

  // ── Retention (2.0) ─────────────────────────────────────────────────────
  {
    id: "R1",
    title: "Personal data has a stated lifetime and a way to delete one person's",
    severity: "should",
    since: "2.0.0",
    component: "retention",
    because:
      "A leaver's data sitting in nine apps with no stated lifetime is nine copies nobody can account for.",
  },

  // ── Design system (2.0) ─────────────────────────────────────────────────
  {
    id: "D1",
    title: "The design system is consumed, never forked into the app",
    severity: "should",
    since: "2.0.0",
    component: "front-end",
    because:
      "Shared material, per-app character through the theme layer. A component copied into an app is how apps stop looking related, one fix at a time.",
  },
];

export const RULE_BY_ID = Object.fromEntries(
  RULES.map((r) => [r.id, r])
);

/** The complexity tripwires, in one place so RULES.md and the checker agree. */
export const CEILINGS = {
  tables: 40,
  sourceBytes: 1_500_000,
  sections: 10,
};

/**
 * Paths the auth middleware may exclude. Anything else in a matcher is
 * reported: excluding a path removes authentication from it.
 */
export const ALLOWED_MIDDLEWARE_EXCLUSIONS = [
  "api/auth",
  "api/v1",
  "api/cron",
  "_next",
  "favicon",
  "sw.js",
  "offline.html",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
];

/**
 * An app's role in the estate, declared as `striConform: { role }` in its
 * package.json. Defaults to "consumer".
 *
 *   consumer — every app but one. Sits behind Suite auth via @stri/auth.
 *   broker   — the STRI Suite itself. It *issues* the sessions every other app
 *              verifies, so it cannot depend on @stri/auth or carry the three
 *              consumer shims; requiring it to would be requiring it to
 *              authenticate against itself. Every other rule still applies,
 *              including the API surface: the Suite holds the estate's
 *              integration registry and its own alert keys.
 */
export const APP_ROLES = ["consumer", "broker"];

/** Checks that only make sense for an app that consumes Suite auth. */
export const CONSUMER_ONLY_RULES = ["S4:middleware-package", "S4:shims", "S4:dependency"];

/**
 * The files every conforming app has. Checked by `stri-conform`; the prose
 * version is RULES.md Part 4.
 */
/**
 * Each entry: `{ paths, what, rule, contains? }`.
 *   paths    — candidates; the first that exists satisfies the requirement.
 *   contains — text that must appear in the file, if any.
 */
export const REQUIRED_FILES = [
  { paths: ["PROJECT.md"], what: "one-sentence purpose", rule: "S1" },
  { paths: ["SPEC.md", "docs/SPEC.md"], what: "the specification", rule: "S1" },
  { paths: ["README.md"], what: "how to run it", rule: "S1" },
  {
    paths: ["src/middleware.ts", "src/middleware.js", "middleware.ts", "middleware.js"],
    what: "the auth middleware",
    rule: "S4",
    contains: ["@stri/auth/middleware"],
  },
  {
    paths: [
      "src/app/api/auth/callback/route.ts",
      "src/app/api/auth/callback/route.js",
      "app/api/auth/callback/route.ts",
      "app/api/auth/callback/route.js",
    ],
    what: "the auth callback shim",
    rule: "S4",
    contains: ["@stri/auth/callback"],
  },
  {
    paths: [
      "src/app/api/auth/signout/route.ts",
      "src/app/api/auth/signout/route.js",
      "app/api/auth/signout/route.ts",
      "app/api/auth/signout/route.js",
    ],
    what: "the sign-out shim",
    rule: "S4",
    contains: ["@stri/auth/signout"],
  },
  {
    paths: ["docs/api/openapi.yaml"], what: "the API contract", rule: "S5",
  },
  {
    paths: ["docs/api/openapi.json"],
    what: "the bundled contract the app serves",
    rule: "S5",
  },
];

/** `/api/v1` endpoints every app exposes identically. */
export const REQUIRED_V1_ROUTES = [
  "health",
  "me",
  "openapi.json",
  "api-keys",
  "api-keys/[id]",
];

/**
 * How a route is recognised as carrying an authorization check.
 *
 * A name list alone does not work. Every app spells its own authz differently
 * — Machine Tracker `getCaller`/`canManage`, the Planner `requireApiCaller` +
 * `has(caller, …)`, ART `getSessionUser`/`requireArtUser`, the SOP tool `getCurrentUser`,
 * `requireAppRole` and `checkIntegrationAuth` — and a checker that only knew
 * one spelling reported ~120 false failures across two apps on its first run.
 * A checker that cries wolf gets switched off, so this matches two ways:
 *
 *   1. the route imports from a module whose path looks like an auth module, or
 *   2. the route mentions one of the explicit markers below.
 *
 * It is a heuristic and is allowed to be: it catches a route with no gate at
 * all, which is the bug class that has actually shipped here. It cannot tell a
 * correct check from a wrong one — that is a review, not a build step.
 */
export const AUTHZ_IMPORT_PATTERN =
  /from\s+["'][^"']*(auth|caller|actor|session|permission|role|guard|gate)[^"']*["']/i;

/**
 * A call that reads like a gate, wherever it was imported from.
 *
 * Needed because the import path is often innocuous while the function is the
 * check: ART resolves its caller with `getSessionUser` from `@/lib/users`, and
 * authenticates Slack with `verifySlackRequest` from `@/lib/slack/verify`.
 * Matching only the path called both of those ungated. Token-URL routes (a
 * phone scanning a QR) gate with `resolve…Token` — the Planner's
 * `resolveMobileUploadToken` is the case that prompted it.
 */
export const AUTHZ_IDENTIFIER_PATTERN =
  /\b(get|require|assert|check|verify|ensure|resolve|is|has|can)[A-Z]\w*(User|Caller|Actor|Session|Auth|Authz|Role|Permission|Admin|Manager|Request|Workload|Signature|Secret|Token|Access)\w*\s*\(/;

export const AUTHZ_MARKERS = [
  // Key-authenticated /api/v1 routes
  "requireWorkload",
  "gate(",
  "apiKeyHandlers",
  "createApiKeyHandlers",
  // Self-authenticating cron and integration secrets
  "CRON_SECRET",
  "INTEGRATION_API_SECRET",
  // Common spellings, for routes that resolve the caller without an import
  // the pattern above would catch.
  "requireCaller",
  "getCaller",
  "requireApiCaller",
  "getStriCaller",
  "getCurrentUser",
  // Deliberately NOT getActor: in ART it is attribution, not authorization,
  // and returns 'web' for nobody.
  "requireArtUser",
  "requireActor",
  "requireAppRole",
  "canManage",
  "hasPermission",
  "requirePermission",
  "isAdmin",
];

/**
 * Methods whose absence of a check is a failure rather than a note.
 *
 * A GET that returns what every signed-in user of the app may see needs no
 * check beyond the middleware, and failing those would flag most of ART's read
 * surface for no reason. A mutation is different: the Planner's real bug was
 * delete-and-edit-by-id with no ownership check, reachable by anyone who could
 * sign in. So mutations must gate; unguarded reads are reported for review.
 */
export const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Routes that legitimately carry no authorization check.
 *
 * `health` reveals only "up" and a commit sha. `openapi.json` serves a
 * committed document. The auth shims establish the session in the first place.
 * Everything else must check something.
 */
export const AUTHZ_EXEMPT_PATTERNS = [
  /api\/auth\//,
  /api\/v1\/health\//,
  /api\/v1\/openapi\.json\//,
];
