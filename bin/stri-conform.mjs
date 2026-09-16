#!/usr/bin/env node
// Entry point for `npx stri-conform`. The checker lives in ../src/conform.mjs;
// this file exists because a bin has to be plain JavaScript that bare node can
// run — Node refuses to strip types from a file inside node_modules, so the
// rules module and the checker are .mjs while the auth modules stay TypeScript
// for Next to transpile.
import { conform, format } from "../src/conform.mjs";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      "stri-conform — check an app against the STRI app rules",
      "",
      "  stri-conform [path]     check that directory (default: cwd)",
      "  stri-conform --json     machine-readable output, for CI",
      "  stri-conform --verbose  show the checks that passed too",
      "  stri-conform --rules    print the rules document",
      "",
      "Exits non-zero when a `must` rule fails. Tripwires are reported but do",
      "not fail the run — crossing one means justify it in PROJECT.md or split",
      "the app. The full ruleset is RULES.md in @stri/auth.",
      "",
    ].join("\n")
  );
  process.exit(0);
}

if (args.includes("--rules")) {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  process.stdout.write(readFileSync(join(here, "..", "RULES.md"), "utf8"));
  process.exit(0);
}

const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
const report = conform(root);
process.stdout.write(
  args.includes("--json")
    ? JSON.stringify(report, null, 2) + "\n"
    : format(report, { verbose: args.includes("--verbose") })
);
process.exit(report.conforms ? 0 : 1);
