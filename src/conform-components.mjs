/**
 * The component half of the checker.
 *
 * An app declares what it is made of; this works out what it is *actually*
 * made of, and reports the difference both ways:
 *
 *   declared but the rules are not followed  → the component's own checks
 *   present but not declared                 → a finding of its own
 *
 * The second direction is the one that makes "not every app has object
 * storage" safe to say. Without it, leaving a component out of the list would
 * be a way to opt out of its rules.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCESS_TABLE, COMPONENTS, COMPONENT_IDS } from "./components.mjs";

function read(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function posix(p) {
  return p.split("\\").join("/");
}

/** What package.json says this app is made of, if anything. */
export function declaredComponents(root) {
  try {
    const pkg = JSON.parse(read(join(root, "package.json")));
    const list = pkg?.striConform?.components;
    if (!Array.isArray(list)) return null;
    return list.filter((c) => COMPONENT_IDS.includes(c));
  } catch {
    return null;
  }
}

/** What the repository shows, whatever it says. */
export function detectComponents(root, files, source) {
  let pkg = {};
  try {
    pkg = JSON.parse(read(join(root, "package.json")));
  } catch { /* the file checks report a missing package.json */ }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const envText = [
    read(join(root, ".env.example")),
    read(join(root, "vercel.json")),
  ].join("\n");
  const relPaths = files.map((f) => posix(f.slice(root.length + 1)));

  const found = [];
  for (const c of COMPONENTS) {
    const d = c.detect ?? {};
    const hit =
      d.always === true ||
      (d.deps ?? []).some((name) => name in deps) ||
      (d.paths ?? []).some(
        (p) => existsSync(join(root, p)) || relPaths.some((r) => r.startsWith(p + "/"))
      ) ||
      (d.env ?? []).some((v) => envText.includes(v) || source.includes(v)) ||
      (d.code instanceof RegExp && d.code.test(source));
    if (hit) found.push(c.id);
  }
  return found;
}

/**
 * Components: declared vs detected, and the dependency graph.
 *
 * `api → permissions` is the rule with teeth. A key can act for a person, so
 * an app with an API and no answer to "what may this person do" has handed
 * that decision to the key.
 */
export function checkComponents(root, declared, detected) {
  const out = [];
  const active = declared ?? detected;

  if (!declared) {
    out.push({
      rule: "components",
      status: "warn",
      message:
        `No striConform.components in package.json — checking what was detected instead: ${detected.join(", ")}`,
      where: ["package.json"],
    });
  } else {
    out.push({
      rule: "components",
      status: "pass",
      message: `declares ${declared.length} component(s): ${declared.join(", ")}`,
      where: ["package.json"],
    });
    const undeclared = detected.filter((c) => !declared.includes(c));
    for (const c of undeclared) {
      out.push({
        rule: "components",
        status: "warn",
        message:
          `'${c}' is present but not declared — either add it to striConform.components and follow its rules, or remove what made it appear`,
        where: ["package.json"],
      });
    }
  }

  for (const id of active) {
    const c = COMPONENTS.find((x) => x.id === id);
    for (const need of c?.dependsOn ?? []) {
      if (!active.includes(need)) {
        out.push({
          rule: "components",
          status: "warn",
          message: `'${id}' depends on '${need}', which this app does not have`,
          where: ["package.json"],
        });
      }
    }
  }
  return out;
}

/** P1 + P2 — the permissions table: one shape, one key, no display identity. */
export function checkPermissionsTable(root, files, schema, source) {
  const out = [];
  const schemaText = schema ? read(schema) : "";
  const where = schema ? [posix(schema.slice(root.length + 1))] : undefined;

  const hasAccessTable = ACCESS_TABLE.names.some((n) =>
    new RegExp(`\\b${n}\\b`).test(schemaText)
  );
  if (!hasAccessTable) {
    out.push({
      rule: "P1",
      status: "warn",
      message:
        "No app_access table — this app's permissions are in a shape of their own. See RULES.md Part 2 §5 and @stri/auth/permissions",
      where,
    });
    return out;
  }

  out.push({ rule: "P1", status: "pass", message: "app_access is defined", where });

  // The table's own block, so a `name` column elsewhere in the schema is not
  // reported against it.
  const block = new RegExp(
    `(app_?[aA]ccess)[\\s\\S]{0,1200}?(?=\\n(?:export const|model|create table)|$)`,
    "i"
  ).exec(schemaText);
  const body = block ? block[0] : schemaText;
  const keyed = new RegExp(ACCESS_TABLE.key.replace("_", "_?"), "i").test(body);
  const offenders = ACCESS_TABLE.forbidden.filter((col) =>
    new RegExp(`["'\`]?\\b${col}\\b["'\`]?\\s*[:(]`, "i").test(body)
  );

  out.push(
    keyed
      ? { rule: "P1", status: "pass", message: "keyed on suite_user_id", where }
      : {
          rule: "P1",
          status: "warn",
          message: "app_access is not keyed on suite_user_id",
          where,
        }
  );
  out.push(
    offenders.length
      ? {
          rule: "P2",
          status: "warn",
          message: `app_access carries display identity (${offenders.join(", ")}) — read it from the Suite directory instead`,
          where,
        }
      : {
          rule: "P2",
          status: "pass",
          message: "no name, email or avatar in the permissions table",
          where,
        }
  );
  return out;
}

/** P4 — somebody grants access from a page, and the grant records who. */
export function checkGrantPage(root, files) {
  const hit = files.find((f) => {
    const r = posix(f.slice(root.length + 1));
    return /page\.(tsx|jsx)$/.test(r) && /(access|people|users|permissions|team)/i.test(r);
  });
  return [
    hit
      ? {
          rule: "P4",
          status: "pass",
          message: "an access page exists",
          where: [posix(hit.slice(root.length + 1))],
        }
      : {
          rule: "P4",
          status: "warn",
          message:
            "No page grants access — roles that can only be changed with SQL are roles nobody maintains",
        },
  ];
}

/** O2 + O3 — a pathname in the row, one module naming the vendor. */
export function checkStorage(root, files, schema, source) {
  const out = [];
  const schemaText = schema ? read(schema) : "";
  const urlColumns = [...schemaText.matchAll(/(\w*(?:blob|file|image|photo|doc)\w*_?url)\s*[:(]/gi)]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
  out.push(
    urlColumns.length
      ? {
          rule: "O2",
          status: "warn",
          message: `columns hold a URL rather than an object pathname: ${urlColumns.join(", ")} — a vendor move then touches every row`,
          where: schema ? [posix(schema.slice(root.length + 1))] : undefined,
        }
      : { rule: "O2", status: "pass", message: "no URL columns in the schema" }
  );

  const vendorFiles = files
    .filter((f) => /\.(ts|js|tsx|mjs)$/.test(f) && !/node_modules/.test(f))
    .filter((f) => /@vercel\/blob|@aws-sdk\/client-s3|R2_ACCOUNT_ID/.test(read(f)))
    .map((f) => posix(f.slice(root.length + 1)))
    .filter((r) => !r.startsWith("scripts/"));
  out.push(
    vendorFiles.length <= 1
      ? {
          rule: "O3",
          status: "pass",
          message: vendorFiles.length
            ? `one module names the storage vendor (${vendorFiles[0]})`
            : "no storage vendor referenced in code",
        }
      : {
          rule: "O3",
          status: "warn",
          message: `${vendorFiles.length} modules name the storage vendor — put it behind one facade`,
          where: vendorFiles.slice(0, 6),
        }
  );
  return out;
}

/** B1 — a cron route refuses when its secret is missing. */
export function checkBackground(root, files) {
  const cronRoutes = files.filter((f) =>
    /api[\\/]cron[\\/].*route\.(ts|js)$/.test(posix(f))
  );
  if (!cronRoutes.length) {
    return [{ rule: "B1", status: "skip", message: "no cron routes" }];
  }
  const failOpen = [];
  for (const f of cronRoutes) {
    const src = read(f);
    const readsSecret = /CRON_SECRET/.test(src);
    // "fail closed" means the route refuses when the variable is absent, not
    // only when it mismatches: `if (!secret) return 401` or an equivalent.
    const failsClosed =
      /!\s*secret|secret\s*(===|==)\s*undefined|!process\.env\.CRON_SECRET|expected\s*\?\?|if\s*\(!expected/.test(src);
    if (!readsSecret || !failsClosed) failOpen.push(posix(f.slice(root.length + 1)));
  }
  return [
    failOpen.length
      ? {
          rule: "B1",
          status: "warn",
          message: `${failOpen.length} cron route(s) may run without a secret — unset the variable and the endpoint is public`,
          where: failOpen,
        }
      : {
          rule: "B1",
          status: "pass",
          message: `${cronRoutes.length} cron route(s) authenticate fail-closed`,
        },
  ];
}

/** A1 — one audit log, and it does not swallow its own failures. */
export function checkAudit(root, files, schema) {
  const schemaText = schema ? read(schema) : "";
  const hasTable = /audit_?log/i.test(schemaText);
  if (!hasTable) {
    return [
      {
        rule: "A1",
        status: "warn",
        message: "No audit log table — actions cannot be attributed to a person later",
      },
    ];
  }
  const writers = files
    .filter((f) => /\.(ts|js|mjs)$/.test(f) && !/node_modules/.test(f))
    .filter((f) => /auditLog|audit_log/.test(read(f)) && /insert|create\s*\(/.test(read(f)))
    .map((f) => posix(f.slice(root.length + 1)));
  return [
    {
      rule: "A1",
      status: writers.length > 2 ? "warn" : "pass",
      message:
        writers.length > 2
          ? `${writers.length} modules write the audit log — one writer, so the shape cannot drift`
          : "an audit log with a single writer",
      where: writers.length > 2 ? writers.slice(0, 6) : undefined,
    },
  ];
}
