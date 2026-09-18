/**
 * The components an STRI app is made of.
 *
 * Not every app has every component. Every app that has one does it the same
 * way — that is the whole claim, and it only works if two things are true:
 *
 *   1. the app SAYS which components it has, in package.json:
 *
 *        "striConform": { "components": ["front-end", "database", "sign-in", "api"] }
 *
 *   2. the checker can SEE a component the app did not declare. An undeclared
 *      component is not a way out of a rule: a BLOB_READ_WRITE_TOKEN with no
 *      storage component is either a component nobody wrote down or a live
 *      credential nobody is using, and both deserve an answer.
 *
 * An app that declares nothing is treated as declaring everything the checker
 * detects, so adding the field is an improvement rather than a gate.
 *
 * The prose for each component is RULES.md Part 2.
 */

/**
 * Each component: `{ id, label, rules, requiredFor?, dependsOn?, detect }`.
 *
 *   rules      — the rule ids that apply when this component is present.
 *   dependsOn  — components that must also be declared. `api → permissions`
 *                is the one that matters: a key can act for a person, so an
 *                app that cannot say what that person may do has handed the
 *                decision to the key.
 *   detect     — how the checker spots the component without being told.
 *                `deps`  a dependency in package.json
 *                `env`   a variable named in .env.example or the code
 *                `paths` a file or directory that exists
 *                `code`  a regex over the app's source
 */
export const COMPONENTS = [
  {
    id: "purpose",
    label: "Purpose and shape",
    always: true,
    rules: ["S1"],
    detect: { always: true },
  },
  {
    id: "front-end",
    label: "Front end",
    rules: ["S2", "D1"],
    detect: { deps: ["next"] },
  },
  {
    id: "database",
    label: "Database",
    rules: ["S3", "N8", "N9", "C1"],
    detect: {
      deps: ["drizzle-orm", "@prisma/client", "pg", "postgres"],
      paths: ["src/db/schema.ts", "prisma/schema.prisma", "db/schema.ts"],
    },
  },
  {
    id: "sign-in",
    label: "Sign-in",
    always: true,
    rules: ["S4", "N4", "N5"],
    detect: { deps: ["@stri/auth"], paths: ["src/middleware.ts", "middleware.ts"] },
  },
  {
    id: "permissions",
    label: "User permissions",
    rules: ["P1", "P2", "P3", "P4"],
    dependsOn: ["sign-in"],
    detect: {
      code: /app_access|user_roles|role_permissions|appUser|app_user|\brole\b\s*:\s*text\(/,
    },
  },
  {
    id: "storage",
    label: "Object storage",
    rules: ["O1", "O2", "O3", "O4"],
    dependsOn: ["sign-in"],
    detect: {
      deps: ["@vercel/blob", "@aws-sdk/client-s3"],
      env: ["BLOB_READ_WRITE_TOKEN", "R2_ACCOUNT_ID", "R2_BUCKET", "S3_BUCKET"],
    },
  },
  {
    id: "api",
    label: "API",
    rules: ["S5", "N2", "N3", "N6"],
    dependsOn: ["permissions"],
    detect: { paths: ["src/app/api/v1", "app/api/v1"] },
  },
  {
    id: "background",
    label: "Background work",
    rules: ["B1", "B2"],
    detect: {
      paths: ["src/app/api/cron", "app/api/cron"],
      env: ["CRON_SECRET"],
      code: /"crons"\s*:/,
    },
  },
  {
    id: "audit",
    label: "Audit log",
    rules: ["A1"],
    dependsOn: ["permissions"],
    detect: { code: /audit_?log|auditLog|writeAudit/i },
  },
  {
    id: "comms",
    label: "Outbound comms",
    rules: ["M1"],
    detect: {
      deps: ["resend", "nodemailer", "web-push"],
      code: /api\/v1\/alerts/,
    },
  },
  {
    id: "model",
    label: "Model access",
    rules: ["X1", "X2"],
    detect: {
      deps: ["@anthropic-ai/sdk", "openai", "ai"],
      env: ["ANTHROPIC_API_KEY", "AI_GATEWAY_API_KEY", "OPENAI_API_KEY"],
    },
  },
  {
    id: "secrets",
    label: "Secrets and config",
    always: true,
    rules: ["N10", "K1"],
    detect: { always: true },
  },
  {
    id: "deploy",
    label: "Deploy and registry",
    always: true,
    rules: ["N7", "N11"],
    detect: { always: true },
  },
  {
    id: "retention",
    label: "Data retention",
    rules: ["R1"],
    detect: { code: /personal data|retention/i },
  },
];

export const COMPONENT_BY_ID = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));

export const COMPONENT_IDS = COMPONENTS.map((c) => c.id);

/** Components every app has, whatever it declares. */
export const ALWAYS_PRESENT = COMPONENTS.filter((c) => c.always).map((c) => c.id);

/**
 * The permissions table, as the estate agrees it looks.
 *
 * Column names are checked rather than suggested: five apps answer "may this
 * person do this?" five ways today, and the differences are historical rather
 * than meaningful.
 */
export const ACCESS_TABLE = {
  names: ["app_access", "appAccess"],
  key: "suite_user_id",
  required: ["role"],
  /**
   * Columns that must NOT be there. A name cached in an app is a name that
   * goes stale silently; a name written back from a session token overwrote
   * two people's email addresses in the Planner's production database.
   */
  forbidden: ["name", "display_name", "displayName", "email", "avatar", "avatar_url", "image"],
};

/**
 * Rules nothing in a repository can honestly verify — they need a person, a
 * dashboard or a live probe. Named here so the checker can list them as
 * reviewed-by-a-human rather than silently passing them.
 */
export const MANUAL_RULES = ["O1", "O4", "K1", "M1", "X1", "X2", "R1", "D1", "N9", "N11"];
