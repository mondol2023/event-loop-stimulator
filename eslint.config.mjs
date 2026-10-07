import { builtinModules } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ---------------------------------------------------------------------------
// Directory dependency rule (PROMPT.md §6.2) and the "never execute user code"
// invariant (§2.1). Enforced here so tooling, not convention, keeps the layers
// apart; tests/tooling/eslint-boundaries.test.ts proves each rule.
//
// `no-restricted-imports` only sees static imports, so every banned specifier
// is also turned into `no-restricted-syntax` selectors for `import()` and
// `require()`. Flat config does not merge options for the same rule across
// blocks (a later block replaces an earlier one), so every block is built by
// `restrict`, which always re-adds the shared bans.
// ---------------------------------------------------------------------------

/**
 * Matches an import of a top-level directory via the `@/` alias or a relative
 * path (`./`, `../../`). Bare package specifiers such as `react-dom/server` never match.
 */
const layer = (dir, tail = "(/|$)") => `^(@/|(\\.{1,2}/)+)${dir}${tail}`;

const NEVER_EXECUTE = "Never execute code: user source is only parsed and interpreted by core/'s VM.";
const VM = { regex: "^(node:)?vm$", message: NEVER_EXECUTE };
const CHILD_PROCESS = {
  regex: "^(node:)?child_process$",
  message: `${NEVER_EXECUTE} Only scripts/conformance/ and tests/conformance/ may spawn real node.`,
};
const NO_APP = { regex: layer("app"), message: "Nothing imports app/: it is routing only." };
// Integration tests call Route Handlers directly (they are plain functions), so
// they may import app/api/**; every other part of app/ stays off limits.
const NO_APP_EXCEPT_API = {
  regex: layer("app", "(/(?!api/)|$)"),
  message: "Nothing imports app/ (only integration tests may import app/api/** route handlers).",
};
const NO_TESTS_OR_SCRIPTS = {
  regex: layer("(tests|scripts)"),
  message: "Nothing imports tests/ or scripts/ (the conformance harness stays out of the product).",
};
// Models are an implementation detail of the data layer: everything else reads
// and writes through server/repositories/*, which return plain domain types and
// own query hardening. Matches `@/server/db/models/*` and relative spellings
// such as `../db/models/User`; a bare `./models/User` inside server/db/ is not a match.
const NO_MODELS = {
  regex: "^(@/server/|(\\.{1,2}/)+(server/)?)db/models(/|$)",
  message: "Mongoose models are private to server/repositories/ and server/db/: use a repository.",
};
const ZOD_ENTRY = "core/shared/zod.ts";
const ZOD_VIA_CORE = {
  regex: "^zod(/.*)?$",
  message: "Import z from @/core/shared/zod: it disables Zod's `new Function` JIT.",
};

const nodeBuiltins = builtinModules.filter((m) => !m.startsWith("_")).join("|");

const CORE_PATTERNS = [
  NO_TESTS_OR_SCRIPTS,
  {
    regex: layer("(server|features|components|lib)"),
    message: "core/ imports only core/ (and pure libraries).",
  },
  {
    regex: "^(react|react-dom|next|server-only)(/.*)?$",
    message: "core/ must stay framework-free.",
  },
  {
    regex: `^(node:.*|(${nodeBuiltins})(/.*)?)$`,
    message: "core/ must not use Node APIs (no I/O, no clock).",
  },
];

// Any reference to these names is banned, which also catches indirect forms
// such as `(0, eval)(…)`, `globalThis.Function` and `window["eval"]`.
const CODE_EXECUTION_NAMES = [
  ["eval", "eval is banned: user code is never executed."],
  ["Function", "The Function constructor is banned: user code is never executed."],
  ["ShadowRealm", "ShadowRealm is banned: user code is never executed."],
].flatMap(([name, message]) => [
  { selector: `Identifier[name='${name}']`, message },
  { selector: `MemberExpression[computed=true][property.value='${name}']`, message },
]);

// esquery regex literals end at the first `/`, so a slash inside is written as \x2F.
const esqueryRegex = (regex) => `/${regex.replaceAll("/", "\\x2F")}/`;

const dynamicImportBans = ({ regex, message }) => [
  { selector: `ImportExpression[source.value=${esqueryRegex(regex)}]`, message },
  { selector: `CallExpression[callee.name='require'][arguments.0.value=${esqueryRegex(regex)}]`, message },
];

/**
 * Both import rules for one block: the shared bans plus `patterns`.
 * `allowChildProcess` is the conformance exception; `allowZod` is for the one
 * module that configures Zod; `allowApiRoutes` is for integration tests; `allowModels` is for the data layer
 * (server/repositories/**, server/db/**), the only code that imports models.
 */
const restrict = ({
  allowChildProcess = false,
  allowZod = false,
  allowModels = false,
  allowApiRoutes = false,
  patterns = [],
} = {}) => {
  const all = [
    VM,
    ...(allowChildProcess ? [] : [CHILD_PROCESS]),
    allowApiRoutes ? NO_APP_EXCEPT_API : NO_APP,
    ...(allowZod ? [] : [ZOD_VIA_CORE]),
    ...(allowModels ? [] : [NO_MODELS]),
    ...patterns,
  ];
  return {
    "no-restricted-imports": ["error", { patterns: all }],
    "no-restricted-syntax": [
      "error",
      ...CODE_EXECUTION_NAMES,
      {
        selector: "ImportExpression:not([source.type='Literal'])",
        message: "import() takes a literal specifier only: a computed one could load user text.",
      },
      ...all.flatMap(dynamicImportBans),
    ],
  };
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: restrict({ patterns: [NO_TESTS_OR_SCRIPTS] }) },
  {
    // core/ is pure TS that runs in the browser, a worker and the server, so it
    // may not reach other layers, React/Next, Node built-ins or the DOM. Pure
    // npm libraries (e.g. @babel/parser) are allowed; see docs/DECISIONS.md ADR-001.
    files: ["core/**/*.{ts,tsx}"],
    rules: restrict({ patterns: CORE_PATTERNS }),
  },
  { files: [ZOD_ENTRY], rules: restrict({ allowZod: true, patterns: CORE_PATTERNS }) },
  {
    // The data layer is the only code that may import Mongoose models.
    files: ["server/repositories/**/*.ts", "server/db/**/*.ts"],
    rules: restrict({ allowModels: true, patterns: [NO_TESTS_OR_SCRIPTS] }),
  },
  {
    // features/ reaches the server only through Server Actions in server/actions/.
    files: ["features/**/*.{ts,tsx}"],
    rules: restrict({
      patterns: [
        NO_TESTS_OR_SCRIPTS,
        {
          regex: layer("server", "(/(?!actions(/|$))|$)"),
          message: "features/ reaches the server only through Server Actions (server/actions/*).",
        },
      ],
    }),
  },
  {
    // The conformance harness is the only code that spawns real node, and only
    // for repo-owned or generated programs (PROMPT.md §3.4). eval/vm stay banned.
    files: ["scripts/conformance/**/*.{ts,mts,mjs}", "tests/conformance/**/*.{ts,mts,mjs}"],
    rules: restrict({ allowChildProcess: true }),
  },
  {
    // Test and tooling code may share helpers with each other.
    files: ["tests/**/*.{ts,tsx,mts}", "scripts/**/*.{ts,mts,mjs}"],
    ignores: ["scripts/conformance/**", "tests/conformance/**"],
    rules: restrict(),
  },
  {
    // Integration tests exercise Route Handlers by calling them directly.
    files: ["tests/integration/**/*.{ts,tsx}"],
    rules: restrict({ allowApiRoutes: true }),
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Conformance fixtures no ESLint parser or rule set can accept by construction (they are programs for
    // real node, never imported): internals probes use V8's `%Name()` natives syntax, which does not parse,
    // and ts-namespace-refused exists to hold a runtime `namespace`, which @typescript-eslint/no-namespace forbids.
    "tests/conformance/internals/**",
    "tests/conformance/fixtures/ts-namespace-refused.cts",
    // Vendored test262 programs (generated by scripts/conformance/vendor-test262.mts; BSD-licensed, never edited).
    "vendor/**",
  ]),
]);

export default eslintConfig;
