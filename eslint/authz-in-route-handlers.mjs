/**
 * Every API route handler must resolve a caller, and every mutation must check
 * a capability.
 *
 * Why this rule exists
 * --------------------
 * `@stri/auth` middleware authenticates; it does not authorize. A valid session
 * gets a caller past the gate, and whether they may do the thing is each
 * route's job. The estate audit keeps finding handlers that never made that
 * check — including deletion of signed H&S attendance sheets, and a route
 * returning sickness notes for all staff.
 *
 * A plain `no-unused-vars` rule does NOT catch this. The shape is:
 *
 *     const caller = await requireApiCaller();
 *     if (isResponse(caller)) return caller;     // <- caller IS read, once
 *     ...                                        // <- and never again
 *
 * so the binding is used and the linter is satisfied while nothing is
 * authorized. That is rule S4 in RULES.md, and this is how it is enforced.
 *
 * This is a heuristic, deliberately
 * ---------------------------------
 * It matches identifiers in the handler's source text rather than proving
 * reachability, so it can be fooled by a caller stashed in a helper it cannot
 * see. It is a build-time reminder, not a security boundary — the boundary is
 * the check you write. Prefer a false positive silenced by an explicit
 * `eslint-disable-next-line` with a reason over a rule so clever nobody trusts
 * it.
 *
 * Per-app configuration
 * ---------------------
 * Every app spells its own authz differently, so `callerResolvers` and
 * `authzChecks` extend the shared defaults rather than replacing them. Add your
 * app's helper via config; never widen the defaults to make one app pass.
 *
 *     // eslint.config.mjs
 *     import authz from "@stri/auth/eslint/authz-in-route-handlers.mjs";
 *
 *     export default [{
 *       files: ["src/app/api/**\/route.ts"],
 *       plugins: { stri: { rules: { "authz-in-route-handlers": authz } } },
 *       rules: {
 *         "stri/authz-in-route-handlers": ["error", {
 *           callerResolvers: ["requireApiCaller", "getStriCaller"],
 *           authzChecks: ["has(", "canEditJob("],
 *           allowUnauthenticated: ["/api/cron/", "/api/v1/health/"],
 *         }],
 *       },
 *     }];
 *
 * Originally written for the Planner (feat/authz-lint-rule, 24 Aug 2026);
 * generalised here so every app gets it from one place.
 */

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Anything that resolves who is calling — the estate-wide baseline, extended
 * per app through the `callerResolvers` option. The `require*Access` helpers
 * both resolve and check, so they belong in this list as well as the one below;
 * omitting them makes the rule flag correctly-gated routes, which is the
 * fastest way to get it switched off.
 */
const DEFAULT_CALLER_RESOLVERS = [
  "requireApiCaller",
  "getStriCaller",
  "requireCaller",
  "getUser",
  "withCaller",
  "requirePermission",
  "requireRole",
  "requireReportsAccess",
  "requireReportsPermission",
  "ensureManager",
  // Used elsewhere in the estate; here so an app does not have to rediscover
  // its neighbour's spelling.
  "getCaller",
  "getCurrentUser",
  "getSessionUser",
  // Not getActor: ART's getActor only names who to attribute a change to and
  // falls back to 'web' when nobody is signed in. Counting it hid 41 ART
  // write routes that never resolved a user at all.
  "requireActor",
  "requireWorkload",
];

/** Anything that decides whether they may proceed. Extended per app. */
const DEFAULT_AUTHZ_CHECKS = [
  "has(",
  "hasRole(",
  "isPermissionAdmin(",
  "requirePermission(",
  "requireRole(",
  "requireReportsAccess(",
  "requireReportsPermission(",
  "canEditJob(",
  "canEditTeamPlan(",
  "canManage(",
  "visibleTeamsFor(",
  "filterByTeam(",
  "forbiddenResponse(",
  "requireAppRole(",
  "requireManager(",
  "hasPermission(",
  "actorMay(",
];

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "API route handlers must resolve a caller; mutations must check a capability",
    },
    schema: [
      {
        type: "object",
        properties: {
          /** Route paths that are deliberately public — cron, mobile-token, auth. */
          allowUnauthenticated: { type: "array", items: { type: "string" } },
          /** Routes where a read is intentionally open to any signed-in user. */
          allowNoCapability: { type: "array", items: { type: "string" } },
          /**
           * Also require a capability check on GET. Off by default: most reads
           * here are reference data that every role legitimately sees, so
           * turning this on produces enough noise to get the rule ignored. Turn
           * it on for an app whose reads carry personal data — the audit found
           * /api/absences/detail returning sickness notes for all staff, and
           * this rule will not catch that shape while the flag is off.
           */
          checkReads: { type: "boolean" },
          /** App-specific caller resolvers, added to the shared defaults. */
          callerResolvers: { type: "array", items: { type: "string" } },
          /** App-specific capability checks, added to the shared defaults. */
          authzChecks: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noCaller:
        "{{method}} resolves no caller. Middleware authenticates but does not authorize — call requireApiCaller() and use the result, or add this route to allowUnauthenticated with a reason.",
      noCapability:
        "{{method}} resolves a caller but never checks a capability, so any signed-in user can call it. Add a permission check, or add this route to allowNoCapability with a reason.",
    },
  },

  create(context) {
    const filename = (context.filename ?? "").replace(/\\/g, "/");
    if (!/\/app\/api\/.*\/route\.[cm]?[jt]sx?$/.test(filename)) return {};

    const opts = context.options[0] ?? {};
    const allowUnauth = opts.allowUnauthenticated ?? [];
    const allowNoCap = opts.allowNoCapability ?? [];
    const matches = (list) => list.some((p) => filename.includes(p));

    if (matches(allowUnauth)) return {};
    const capabilityExempt = matches(allowNoCap);
    const checkReads = opts.checkReads === true;
    const resolvers = [...DEFAULT_CALLER_RESOLVERS, ...(opts.callerResolvers ?? [])];
    const checks = [...DEFAULT_AUTHZ_CHECKS, ...(opts.authzChecks ?? [])];

    const source = context.sourceCode ?? context.getSourceCode();

    function check(node, method) {
      const text = source.getText(node);

      // A method that exists only to return 405 has nothing to authorize.
      // /api/roles does this deliberately: role editing is disabled in code.
      if (/\b405\b/.test(text) && text.length < 400) return;

      const hasCaller = resolvers.some((fn) => text.includes(fn));

      if (!hasCaller) {
        context.report({ node, messageId: "noCaller", data: { method } });
        return;
      }

      if (capabilityExempt) return;

      // Mutations always need a capability check. Reads only when the rule is
      // configured to demand it — see `checkReads` in the options for why that
      // is off by default.
      const needsCheck = MUTATING.has(method) || (checkReads && method === "GET");
      if (!needsCheck) return;

      const hasCheck = checks.some((fn) => text.includes(fn));
      if (!hasCheck) {
        context.report({ node, messageId: "noCapability", data: { method } });
      }
    }

    return {
      // export async function POST(req) { ... }
      ExportNamedDeclaration(node) {
        const decl = node.declaration;
        if (!decl) return;

        if (decl.type === "FunctionDeclaration" && METHODS.has(decl.id?.name)) {
          check(decl, decl.id.name);
          return;
        }

        // export const POST = withCaller(async (caller) => { ... })
        if (decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) {
            if (d.id.type === "Identifier" && METHODS.has(d.id.name) && d.init) {
              check(d.init, d.id.name);
            }
          }
        }
      },
    };
  },
};
