/**
 * The STRI app rules checker. Driven by `bin/stri-conform.mjs`.
 *
 * Plain ESM rather than TypeScript, unlike the auth modules beside it: this
 * runs as a CLI under bare `node`, and Node refuses to strip types from a file
 * inside `node_modules`, so a `.ts` checker could not be executed by the very
 * apps that depend on it.
 *
 * What this can and cannot do. It checks the mechanically checkable — files
 * present, middleware wired, routes carrying an authz marker, tables counted.
 * It cannot check that an app has one *purpose*, that a DTO omits the right
 * column, or that a scope was granted to the right consumer. Those are in
 * RULES.md for a person to read. **A green run means nothing obvious is wrong,
 * not that the app is well designed.**
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import {
  ALLOWED_MIDDLEWARE_EXCLUSIONS,
  AUTHZ_EXEMPT_PATTERNS,
  AUTHZ_IDENTIFIER_PATTERN,
  AUTHZ_IMPORT_PATTERN,
  AUTHZ_MARKERS,
  MUTATING_METHODS,
  CEILINGS,
  REQUIRED_FILES,
  REQUIRED_V1_ROUTES,
  APP_ROLES,
  RULES_VERSION,
  RULE_BY_ID,
} from "./rules.mjs";

/**
 * A finding is `{ rule, status, message, where? }`, where `status` is
 * "pass" | "fail" | "warn" | "skip" and `where` lists repo-relative paths.
 */

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", ".vercel", ".turbo",
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

function read(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Repo-relative, forward slashes, so patterns read the same on Windows. */
function rel(root, p) {
  return relative(root, p).split(sep).join("/");
}

// ── Checks ────────────────────────────────────────────────────────────────

/** S1 — PROJECT.md opens with a single sentence of purpose. */
function checkPurpose(root) {
  if (!existsSync(join(root, "PROJECT.md"))) {
    return [{ rule: "S1", status: "fail", message: "No PROJECT.md", where: ["PROJECT.md"] }];
  }
  const line = read(join(root, "PROJECT.md"))
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("[!") && !l.startsWith(">"));

  if (!line) {
    return [{
      rule: "S1", status: "fail",
      message: "PROJECT.md has no purpose sentence under its title",
      where: ["PROJECT.md"],
    }];
  }
  if (line.length > 320) {
    return [{
      rule: "S1", status: "warn",
      message: `Purpose sentence is ${line.length} characters — that is a paragraph. One sentence, or the app has no single purpose to state.`,
      where: ["PROJECT.md"],
    }];
  }
  return [{
    rule: "S1", status: "pass",
    message: `"${line.slice(0, 110)}${line.length > 110 ? "…" : ""}"`,
  }];
}

/** S2 — one front end, Next.js App Router. */
function checkFrontEnd(root, files) {
  const hasApp = files.some((f) => /(^|\/)app\/.*page\.(tsx|jsx)$/.test(rel(root, f)));
  const pagesRoutes = files.filter((f) => {
    const r = rel(root, f);
    return /(^|\/)pages\//.test(r) && !/\/pages\/api\//.test(r) && /\.(tsx|jsx)$/.test(r);
  });
  const pagesApi = files.filter((f) => /\/pages\/api\//.test(rel(root, f)));

  if (!hasApp && pagesRoutes.length) {
    return [{
      rule: "S2", status: "fail",
      message: `Pages Router app (${pagesRoutes.length} pages, no App Router pages found)`,
    }];
  }
  if (pagesRoutes.length || pagesApi.length) {
    return [{
      rule: "S2", status: "warn",
      message: `Mixed routers: ${pagesRoutes.length} Pages Router page(s) and ${pagesApi.length} pages/api route(s). New work belongs under app/.`,
      where: [...pagesRoutes, ...pagesApi].slice(0, 6).map((f) => rel(root, f)),
    }];
  }
  return [{ rule: "S2", status: "pass", message: "App Router only" }];
}

/** S4 + N4 — middleware wired, and its exclusions a justified closed set. */
function checkMiddleware(root, files, role = "consumer") {
  const mw = files.find((f) => /(^|\/)(src\/)?middleware\.(ts|js)$/.test(rel(root, f)));
  if (!mw) {
    return [{ rule: "S4", status: "fail", message: "No middleware.ts — the app is not behind Suite auth" }];
  }
  const src = read(mw);
  const where = [rel(root, mw)];
  const out = [];

  if (role === "broker") {
    out.push({
      rule: "S4", status: "skip",
      message: "auth broker — issues sessions rather than verifying them, so @stri/auth/middleware does not apply",
      where,
    });
  } else if (!src.includes("@stri/auth/middleware")) {
    out.push({ rule: "S4", status: "fail", message: "middleware does not use @stri/auth/middleware", where });
  }

  // Read the array as a run of string literals, so a `]` inside a character
  // class (`board/[^/]+`) does not end it early.
  const matcher =
    /matcher:\s*\[((?:\s|,|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)*)\]/.exec(src)?.[1] ?? "";
  if (!matcher) {
    out.push({ rule: "N4", status: "warn", message: "No matcher found — verify the default gates everything", where });
    return out;
  }

  // Everything inside the negative lookahead is excluded from authentication.
  const lookahead =
    /\(\?!([\s\S]*?)\)\.\*/.exec(matcher)?.[1] ??
    /\(\?!([^)]*)\)/.exec(matcher)?.[1] ??
    "";
  const excluded = lookahead
    // Drop the static-asset extension alternation first — `.*\.(?:svg|png|…)$`
    // is one exclusion, and splitting on `|` before removing it would report
    // every image extension as a separate unlisted path. The backslashes are
    // doubled in the matcher's string literal, so allow any run of them.
    .replace(/\.\*\\*\.\((\?:)?[^)]*\)\$?/g, "")
    .split("|")
    .map((s) => s.trim().replace(/\\/g, "").replace(/\$$/, "").replace(/^\^/, ""))
    .filter(Boolean)
    .filter((s) => !s.startsWith(".*"));

  // Excluding all of `api/` necessarily excludes api/auth and api/v1 — but it
  // also removes the middleware as a backstop for every other API route, so
  // the app is relying entirely on each route checking for itself. That is a
  // real posture (the SOP tool takes it deliberately, to keep an expired
  // session from rendering raw 401 JSON into a form POST), not a bug, but it
  // raises the stakes on every unguarded route found above.
  const blanketApi = excluded.some((e) => e === "api" || e === "api/");
  if (blanketApi) {
    out.push({
      rule: "N4", status: "warn",
      message: "matcher excludes ALL of api/ — no middleware backstop on any API route, so every one must gate itself. Make sure the reason is written beside the matcher.",
      where,
    });
  } else {
    for (const need of ["api/auth", "api/v1"]) {
      if (excluded.some((e) => e.startsWith(need))) {
        out.push({ rule: "N4", status: "pass", message: `matcher excludes ${need}/`, where });
      } else {
        out.push({
          rule: need === "api/v1" ? "S5" : "S4",
          status: "fail",
          message:
            need === "api/v1"
              ? "matcher does not exclude api/v1/ — every machine caller will be redirected to the Suite login"
              : "matcher does not exclude api/auth/ — sign-in cannot complete",
          where,
        });
      }
    }
  }

  // N4 asks for a written reason beside each extra exclusion. An exclusion
  // named in the file's comments counts as justified; the checker cannot judge
  // the reason, only that one was written down.
  const comments = (src.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? []).join("\n");
  const namedInComments = (e) => {
    const base = e.replace(/\[[^\]]*\][+*]?/g, "").replace(/[()?+*$^]/g, "");
    return base.length > 1 && comments.includes(base);
  };
  const unknown = excluded.filter(
    (e) =>
      !ALLOWED_MIDDLEWARE_EXCLUSIONS.some((a) => e.startsWith(a)) &&
      !namedInComments(e)
  );
  if (unknown.length) {
    out.push({
      rule: "N4", status: "warn",
      message: `Unlisted exclusion(s): ${unknown.join(", ")} — each removes authentication from that path and needs a written reason beside it`,
      where,
    });
  }
  return out;
}

/**
 * S4 — API routes carry an authorization check of their own.
 *
 * Mutations that do not are a failure: that is the Planner's shipped bug —
 * delete and edit by id, reachable by anyone who could sign in. Unguarded
 * reads are reported separately as a tripwire, because a GET returning what
 * every signed-in user may see legitimately needs nothing beyond the
 * middleware.
 */
function checkRouteAuthz(root, files) {
  const all = files.filter((f) => {
    const r = rel(root, f);
    return (/\/api\//.test(r) && /\/route\.(ts|js)$/.test(r)) ||
           (/\/pages\/api\//.test(r) && /\.(ts|js)$/.test(r));
  });

  if (!all.length) return [{ rule: "S4", status: "skip", message: "No API routes found" }];

  const ungatedMutations = [];
  const ungatedReads = [];

  for (const f of all) {
    const r = rel(root, f);
    if (AUTHZ_EXEMPT_PATTERNS.some((re) => re.test(r))) continue;

    const src = read(f);
    // A route that exists only to refuse (every method answers 405) has
    // nothing to authorize — the same allowance the lint rule makes.
    if (/\b405\b/.test(src) && src.length < 800) continue;
    const gated =
      AUTHZ_IMPORT_PATTERN.test(src) ||
      AUTHZ_IDENTIFIER_PATTERN.test(src) ||
      AUTHZ_MARKERS.some((m) => src.includes(m));
    if (gated) continue;

    const mutates = MUTATING_METHODS.some((m) =>
      new RegExp(`(export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b)`).test(src)
    );
    (mutates ? ungatedMutations : ungatedReads).push(r);
  }

  const out = [];

  // The real enforcement for S4 is the eslint rule, which works per handler and
  // catches the shape this file-level scan cannot: a route that resolves a
  // caller, returns early on the error, and then never checks a capability.
  // Having it wired in is worth more than any scan here, so that is what is
  // required; the scan below stays as a coarse backstop for apps mid-adoption.
  const eslintConfig = ["eslint.config.mjs", "eslint.config.js", ".eslintrc.json"]
    .map((f) => join(root, f))
    .find(existsSync);
  const lintWired =
    eslintConfig && /authz-in-route-handlers/.test(read(eslintConfig));
  out.push(
    lintWired
      ? { rule: "S4", status: "pass", message: "authz-in-route-handlers lint rule is wired in", where: [rel(root, eslintConfig)] }
      : {
          rule: "S4", status: "fail",
          message: "The authz-in-route-handlers lint rule is not wired in. Import it from @stri/auth/eslint/authz-in-route-handlers.mjs — it is the only check that catches a route which resolves a caller and then never checks a capability.",
          where: eslintConfig ? [rel(root, eslintConfig)] : ["eslint.config.mjs"],
        }
  );

  if (ungatedMutations.length) {
    out.push({
      rule: "S4", status: "fail",
      message: `${ungatedMutations.length} of ${all.length} API route(s) mutate data with no authorization check at all — the middleware only authenticates, so a valid session passes straight through`,
      where: ungatedMutations.slice(0, 30),
    });
  }
  if (ungatedReads.length) {
    out.push({
      rule: "S4", status: "warn",
      message: `${ungatedReads.length} read-only route(s) carry no authorization check. Fine if every signed-in user may see the data; a leak if not — check each one.`,
      where: ungatedReads.slice(0, 20),
    });
  }
  if (!out.length) {
    out.push({ rule: "S4", status: "pass", message: `all ${all.length} API routes carry an authz check` });
  }
  return out;
}

/** S5 — the /api/v1 platform surface, the mint gate, and the contract. */
function checkApiSurface(root, files) {
  const rels = files.map((f) => rel(root, f));
  const out = [];

  const missing = REQUIRED_V1_ROUTES
    .filter((r) => !rels.some((p) => p.includes(`api/v1/${r}/route.`)))
    .map((r) => `/api/v1/${r}`);
  out.push(
    missing.length
      ? { rule: "S5", status: "fail", message: `Missing platform endpoint(s): ${missing.join(", ")}` }
      : { rule: "S5", status: "pass", message: "all five platform endpoints present" }
  );

  // Found by content, not filename: apps put this in lib/api/key-handlers.ts,
  // in api/v1/api-keys/handlers.ts, or inline in the route itself.
  const handlers = files.find(
    (f) => /\.(ts|js|mjs)$/.test(f) && read(f).includes("createApiKeyHandlers(")
  );
  if (!handlers) {
    out.push({
      rule: "S5", status: "fail",
      message: "Nothing calls createApiKeyHandlers — no way to mint an API key",
    });
  } else {
    const src = read(handlers);
    const where = [rel(root, handlers)];
    if (!/isAdmin/.test(src)) {
      out.push({
        rule: "S5", status: "fail",
        message: "createApiKeyHandlers has no isAdmin gate — anyone who can sign in could mint a key",
        where,
      });
    } else {
      out.push({ rule: "S5", status: "pass", message: "keys minted behind an isAdmin gate", where });
    }
  }

  const adminPage = rels.find(
    (p) => /(api-access|settings\/api|admin\/api)/.test(p) && /page\.(tsx|jsx)$/.test(p)
  );
  out.push(
    adminPage
      ? { rule: "S5", status: "pass", message: "API access admin page present", where: [adminPage] }
      : {
          rule: "S5", status: "warn",
          message: "No API-access admin page — minting a key needs a hand-written request, which means only its author can do it",
        }
  );

  const bundled = join(root, "docs/api/openapi.json");
  if (existsSync(bundled)) {
    const raw = read(bundled);
    // Only EXTERNAL refs are a problem. `#/components/…` is normal in a bundled
    // spec and resolves against the document itself; a ref to `./common.yaml`
    // resolves for nobody fetching /api/v1/openapi.json over HTTP.
    const external = [...raw.matchAll(/"\$ref":\s*"([^"#][^"]*)"/g)].map((m) => m[1]);
    if (external.length) {
      const unique = [...new Set(external)];
      out.push({
        rule: "S5", status: "warn",
        message: `docs/api/openapi.json carries ${external.length} external $ref(s) (${unique.slice(0, 3).join(", ")}) — bundle it so a consumer fetching /api/v1/openapi.json gets a self-contained document`,
        where: ["docs/api/openapi.json"],
      });
    }
    try {
      if (!JSON.parse(raw).info?.["x-stri-scopes"]) {
        out.push({ rule: "S5", status: "warn", message: "Spec declares no x-stri-scopes", where: ["docs/api/openapi.json"] });
      }
    } catch {
      out.push({ rule: "S5", status: "fail", message: "docs/api/openapi.json is not valid JSON", where: ["docs/api/openapi.json"] });
    }
  }
  return out;
}

/** N1 — identity keyed on the Suite account id. */
function checkIdentity(root, files) {
  const schema = files.find((f) => /db\/schema\.(ts|js)$/.test(rel(root, f)));
  if (!schema) return [{ rule: "N1", status: "skip", message: "No db/schema found" }];
  const where = [rel(root, schema)];
  return [
    /suite_?[uU]ser_?[iI]d/.test(read(schema))
      ? { rule: "N1", status: "pass", message: "a person is keyed on suite_user_id", where }
      : {
          rule: "N1", status: "warn",
          message: "No suite_user_id column — if this app stores people, key them on the Suite account id, never email",
          where,
        },
  ];
}

/** N6 — the api_key table, with the columns the estate contract fixes. */
function checkKeyStorage(root, files) {
  const needed = ["hash", "scopes", "environment", "revoked", "expires"];
  for (const f of files.filter((x) => /\.(ts|js|mjs|sql)$/.test(x))) {
    const src = read(f);
    if (!/pgTable\(\s*["']api_key["']|CREATE TABLE IF NOT EXISTS api_key/.test(src)) continue;
    const missing = needed.filter((c) => !new RegExp(c, "i").test(src));
    const where = [rel(root, f)];
    return [
      missing.length
        ? { rule: "N6", status: "warn", message: `api_key table missing column(s): ${missing.join(", ")}`, where }
        : { rule: "N6", status: "pass", message: "api_key has hash, scopes, environment, expiry and revocation", where },
    ];
  }
  return [{ rule: "N6", status: "fail", message: "No api_key table defined — keys cannot be stored hashed" }];
}

/** N5 + N7 — no pre-auth branch; @stri/auth pinned. */
function checkDeploy(root, role = "consumer") {
  const out = [];
  const branches = git(root, ["branch", "-r"]);
  if (branches == null) {
    out.push({ rule: "N7", status: "skip", message: "Not a git checkout with a remote" });
  } else if (/origin\/vercel\b/.test(branches)) {
    out.push({
      rule: "N5", status: "fail",
      message: "A remote 'vercel' branch exists — that pattern carries a pre-auth copy of the app",
    });
  } else {
    out.push({ rule: "N7", status: "pass", message: "no remote 'vercel' branch" });
  }

  if (existsSync(join(root, "package.json"))) {
    try {
      const dep = JSON.parse(read(join(root, "package.json"))).dependencies?.["@stri/auth"] ?? "";
      if (role === "broker") {
        out.push({ rule: "S4", status: "skip", message: "auth broker — does not depend on @stri/auth" });
      } else if (!dep) {
        out.push({ rule: "S4", status: "fail", message: "@stri/auth is not a dependency" });
      } else if (!/#v\d+\.\d+\.\d+/.test(dep)) {
        out.push({ rule: "S4", status: "warn", message: `@stri/auth is not pinned to a version tag ("${dep}")` });
      } else {
        out.push({ rule: "S4", status: "pass", message: `@stri/auth ${/#(v[\d.]+)/.exec(dep)[1]}` });
      }
    } catch { /* an unreadable package.json shows up in the file checks */ }
  }
  return out;
}

/** N10 — no secret in git. */
function checkSecrets(root) {
  const tracked = git(root, ["ls-files"]);
  if (tracked == null) return [{ rule: "N10", status: "skip", message: "Not a git checkout" }];
  const out = [];

  const leaked = tracked
    .split("\n")
    .filter((f) => /(^|\/)\.env($|\.)/.test(f) && !/\.(example|sample|template)$/.test(f));
  out.push(
    leaked.length
      ? { rule: "N10", status: "fail", message: `Env file(s) tracked in git: ${leaked.join(", ")}`, where: leaked }
      : { rule: "N10", status: "pass", message: "no env file tracked" }
  );

  const ignore = read(join(root, ".gitignore"));
  if (ignore && !/\.env/.test(ignore)) {
    out.push({ rule: "N10", status: "warn", message: ".gitignore does not mention .env" });
  }
  return out;
}

/** N8 — no DDL on boot. */
function checkBootMigrations(root, files) {
  const hits = [];
  for (const f of files.filter((x) => /(instrumentation|layout|middleware)\.(ts|tsx|js)$/.test(x))) {
    if (/\b(migrate\(|drizzle-kit|CREATE TABLE|ALTER TABLE)/i.test(read(f))) hits.push(rel(root, f));
  }
  return [
    hits.length
      ? {
          rule: "N8", status: "fail",
          message: "Schema DDL runs on boot — a preview deployment will apply it to whatever database it is pointed at",
          where: hits,
        }
      : { rule: "N8", status: "pass", message: "no DDL on boot" },
  ];
}

/** C1–C3 — the complexity tripwires. */
function checkCeilings(root, files) {
  const out = [];

  const schema = files.find((f) => /db\/schema\.(ts|js)$/.test(rel(root, f)));
  let tables = 0;
  let source = null;
  if (schema) {
    tables = (read(schema).match(/pgTable\(/g) ?? []).length;
    source = rel(root, schema);
  } else {
    // Raw-SQL apps create tables in code; count those instead.
    const seen = new Set();
    for (const f of files.filter((x) => /\.(ts|js|mjs|sql)$/.test(x))) {
      for (const m of read(f).matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) seen.add(m[1]);
    }
    tables = seen.size;
  }
  if (tables) {
    out.push({
      rule: "C1",
      status: tables > CEILINGS.tables ? "warn" : "pass",
      message: `${tables} tables (tripwire ${CEILINGS.tables}; Machine Tracker has 13)`,
      where: source ? [source] : undefined,
    });
  }

  const code = files.filter(
    (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/\.d\.ts$/.test(f) && !/\.(test|spec)\./.test(f)
  );
  let bytes = 0;
  for (const f of code) {
    try { bytes += statSync(f).size; } catch { /* vanished mid-walk */ }
  }
  out.push({
    rule: "C2",
    status: bytes > CEILINGS.sourceBytes ? "warn" : "pass",
    message: `${Math.round(bytes / 1024)} KB of source across ${code.length} files (tripwire ${Math.round(CEILINGS.sourceBytes / 1024)} KB; Machine Tracker has 375 KB)`,
  });

  const sections = new Set();
  for (const f of files) {
    const m = /(?:^|\/)app\/(?:\([^)]+\)\/)?([^/()]+)\/(?:[^/]+\/)*page\.(tsx|jsx)$/.exec(rel(root, f));
    if (m && m[1] !== "api") sections.add(m[1]);
  }
  if (sections.size) {
    out.push({
      rule: "C3",
      status: sections.size > CEILINGS.sections ? "warn" : "pass",
      message: `${sections.size} top-level sections (tripwire ${CEILINGS.sections}): ${[...sections].sort().join(", ")}`,
    });
  }
  return out;
}

/** Part 4 — the required files. */
function checkRequiredFiles(root, role = "consumer") {
  const out = [];
  for (const req of REQUIRED_FILES) {
    // The consumer shims exist to verify a Suite session; the broker mints
    // them, so it has neither — and its own middleware gates on its own
    // session code rather than on @stri/auth.
    const consumerAuthFile = (req.contains ?? []).some((c) => c.startsWith("@stri/auth/"));
    if (role === "broker" && consumerAuthFile) {
      out.push({
        rule: req.rule, status: "skip",
        message: `${req.what} — not applicable to the auth broker`,
      });
      continue;
    }
    const found = req.paths.find((p) => existsSync(join(root, p)));
    if (!found) {
      out.push({
        rule: req.rule, status: "fail",
        message: `Missing ${req.what} (${req.paths[0]})`,
        where: [req.paths[0]],
      });
      continue;
    }
    const missing = (req.contains ?? []).filter((c) => !read(join(root, found)).includes(c));
    out.push(
      missing.length
        ? {
            rule: req.rule, status: "fail",
            message: `${found} does not reference ${missing.join(", ")}`,
            where: [found],
          }
        : { rule: req.rule, status: "pass", message: found }
    );
  }
  return out;
}

// ── Runner ────────────────────────────────────────────────────────────────

/**
 * Check one app. Returns
 * `{ app, rulesVersion, findings, failed, warned, passed, conforms }`.
 */
export function conform(root) {
  const files = walk(root);

  // The Suite is the auth broker: it issues the sessions the other apps
  // verify, so the consumer-side auth checks do not apply to it. Declared in
  // package.json as `striConform: { role: "broker" }` rather than guessed from
  // the repo name, so the exemption is a deliberate, visible claim.
  let role = "consumer";
  try {
    const declared = JSON.parse(read(join(root, "package.json")))?.striConform?.role;
    if (APP_ROLES.includes(declared)) role = declared;
  } catch { /* no package.json is reported by the file checks */ }
  const findings = [
    ...checkPurpose(root),
    ...checkRequiredFiles(root, role),
    ...checkFrontEnd(root, files),
    ...checkMiddleware(root, files, role),
    ...checkRouteAuthz(root, files),
    ...checkApiSurface(root, files),
    ...checkIdentity(root, files),
    ...checkKeyStorage(root, files),
    ...checkDeploy(root, role),
    ...checkSecrets(root),
    ...checkBootMigrations(root, files),
    ...checkCeilings(root, files),
  ];

  let app = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  try {
    app = JSON.parse(read(join(root, "package.json"))).name ?? app;
  } catch { /* keep the directory name */ }

  const failed = findings.filter((f) => f.status === "fail").length;
  return {
    app,
    role,
    rulesVersion: RULES_VERSION,
    findings,
    failed,
    warned: findings.filter((f) => f.status === "warn").length,
    passed: findings.filter((f) => f.status === "pass").length,
    conforms: failed === 0,
  };
}

const ICON = { pass: "  ok ", fail: "FAIL ", warn: "warn ", skip: "  -- " };

export function format(r, { verbose = false } = {}) {
  const lines = [
    "",
    `${r.app} — STRI app rules v${r.rulesVersion}` + (r.role === "broker" ? "  [auth broker]" : ""),
    "─".repeat(52),
  ];
  for (const f of r.findings) {
    // The useful output is what is wrong; --verbose shows the passes too.
    if (f.status === "pass" && !verbose) continue;
    lines.push(`${ICON[f.status]} ${f.rule}  ${f.message}`);
    if (f.status === "fail" && RULE_BY_ID[f.rule]) {
      lines.push(`        why: ${RULE_BY_ID[f.rule].because}`);
    }
    for (const w of f.where ?? []) lines.push(`        ${w}`);
  }
  lines.push(
    "",
    `${r.passed} passed, ${r.warned} tripwire${r.warned === 1 ? "" : "s"}, ` +
      `${r.failed} failure${r.failed === 1 ? "" : "s"}` +
      (r.conforms ? "  — conforms" : "  — DOES NOT CONFORM"),
    ""
  );
  return lines.join("\n");
}
