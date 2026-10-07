import fc from "fast-check";

// Grammar-based generator of small, deterministic event-loop programs (PROMPT.md §3.4).
// It builds a statement MODEL and renders it, so fast-check shrinks structurally (drop a
// statement, flatten a callback, shorten a body) instead of by characters.
//
// Rules that keep a program deterministic on real Node:
// - Delays are in {0, 1, 2, 5, 10} ms and every timer is created before the loop starts
//   (main script or a nextTick / microtask / promise callback). A callback that runs from a
//   timer never creates one, so no two timers can tie on an expiry that depends on timing.
// - No `setImmediate`: its order against a timer created in the same tick depends on how
//   long the process took to start.
// - Nothing throws out of a callback: every rejection ends in a handler, so stderr is empty
//   and the exit code is 0.

export type Expr =
  | { readonly kind: "int"; readonly n: number }
  | { readonly kind: "str"; readonly s: string }
  | { readonly kind: "arith"; readonly op: "+" | "-" | "*"; readonly a: number; readonly b: number }
  | { readonly kind: "concat"; readonly s: string; readonly n: number };

export type AsyncItem =
  | { readonly kind: "log"; readonly e: Expr }
  | { readonly kind: "await"; readonly what: "value" | "resolved" | "thenable"; readonly n: number }
  | { readonly kind: "awaitReject"; readonly message: string };

export type Link =
  | { readonly kind: "then"; readonly body: readonly Stmt[] }
  | { readonly kind: "throw"; readonly message: string }
  | { readonly kind: "catch"; readonly body: readonly Stmt[] }
  | { readonly kind: "finally"; readonly body: readonly Stmt[] };

export type Stmt =
  | { readonly kind: "log"; readonly e: Expr }
  | { readonly kind: "nextTick"; readonly body: readonly Stmt[] }
  | { readonly kind: "microtask"; readonly body: readonly Stmt[] }
  | { readonly kind: "timeout"; readonly delay: number; readonly body: readonly Stmt[] }
  | { readonly kind: "chain"; readonly head: Head; readonly links: readonly Link[] }
  | { readonly kind: "async"; readonly items: readonly AsyncItem[] };

export type Head = { readonly kind: "resolve"; readonly n: number } | { readonly kind: "reject"; readonly message: string };

export type Program = readonly Stmt[];

export const DELAYS = [0, 1, 2, 5, 10] as const;
const MAX_DEPTH = 2;

// ---- arbitraries ------------------------------------------------------------------------------

const word = fc.string({ unit: fc.constantFrom(..."abcxyz012 ".split("")), minLength: 0, maxLength: 5 });
const small = fc.integer({ min: -9, max: 99 });

const expr: fc.Arbitrary<Expr> = fc.oneof(
  small.map((n): Expr => ({ kind: "int", n })),
  word.map((s): Expr => ({ kind: "str", s })),
  fc
    .tuple(fc.constantFrom("+", "-", "*"), small, small)
    .map(([op, a, b]): Expr => ({ kind: "arith", op, a, b })),
  fc.tuple(word, small).map(([s, n]): Expr => ({ kind: "concat", s, n })),
);

const asyncItem: fc.Arbitrary<AsyncItem> = fc.oneof(
  { weight: 3, arbitrary: expr.map((e): AsyncItem => ({ kind: "log", e })) },
  {
    weight: 3,
    arbitrary: fc
      .tuple(fc.constantFrom("value", "resolved", "thenable"), small)
      .map(([what, n]): AsyncItem => ({ kind: "await", what, n })),
  },
  { weight: 1, arbitrary: word.map((message): AsyncItem => ({ kind: "awaitReject", message })) },
);

const asyncStmt: fc.Arbitrary<Stmt> = fc
  .array(asyncItem, { minLength: 1, maxLength: 4 })
  .map((items): Stmt => ({ kind: "async", items }));

const logStmt: fc.Arbitrary<Stmt> = expr.map((e): Stmt => ({ kind: "log", e }));

/** `inTimer`: the statements will run from a timer callback, so they may not create timers. */
function body(depth: number, inTimer: boolean): fc.Arbitrary<readonly Stmt[]> {
  return fc.array(stmt(depth, inTimer), { minLength: 1, maxLength: 2 });
}

function link(depth: number, inTimer: boolean): fc.Arbitrary<Link> {
  return fc.oneof(
    body(depth, inTimer).map((b): Link => ({ kind: "then", body: b })),
    word.map((message): Link => ({ kind: "throw", message })),
    body(depth, inTimer).map((b): Link => ({ kind: "catch", body: b })),
    body(depth, inTimer).map((b): Link => ({ kind: "finally", body: b })),
  );
}

function stmt(depth: number, inTimer: boolean): fc.Arbitrary<Stmt> {
  const leaves: fc.Arbitrary<Stmt>[] = [logStmt, asyncStmt];
  if (depth <= 0) return fc.oneof(...leaves);
  const nested: fc.Arbitrary<Stmt>[] = [
    body(depth - 1, inTimer).map((b): Stmt => ({ kind: "nextTick", body: b })),
    body(depth - 1, inTimer).map((b): Stmt => ({ kind: "microtask", body: b })),
    fc
      .tuple(
        fc.oneof(
          small.map((n): Head => ({ kind: "resolve", n })),
          word.map((message): Head => ({ kind: "reject", message })),
        ),
        fc.array(link(depth - 1, inTimer), { minLength: 1, maxLength: 3 }),
      )
      .map(([head, links]): Stmt => ({ kind: "chain", head, links })),
  ];
  if (!inTimer) {
    nested.push(
      fc
        .tuple(fc.constantFrom(...DELAYS), body(depth - 1, true))
        .map(([delay, b]): Stmt => ({ kind: "timeout", delay, body: b })),
    );
  }
  // Statements that schedule are as likely as plain logs together.
  return fc.oneof({ weight: 2, arbitrary: fc.oneof(...leaves) }, { weight: 3, arbitrary: fc.oneof(...nested) });
}

export const programModelArbitrary: fc.Arbitrary<Program> = fc.array(stmt(MAX_DEPTH, false), { minLength: 1, maxLength: 5 });

// ---- rendering ----------------------------------------------------------------------------------

function renderExpr(e: Expr): string {
  switch (e.kind) {
    case "int":
      return String(e.n);
    case "str":
      return JSON.stringify(e.s);
    case "arith":
      return `(${e.a} ${e.op} ${e.b})`;
    case "concat":
      return `(${JSON.stringify(e.s)} + ${e.n})`;
    default:
      return assertNever(e);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled model node: ${JSON.stringify(value)}`);
}

class Renderer {
  private functions = 0;

  program(program: Program): string {
    return `${this.statements(program, "")}\n`;
  }

  private statements(list: readonly Stmt[], indent: string): string {
    return list.map((s) => this.statement(s, indent)).join("\n");
  }

  private callback(params: string, list: readonly Stmt[], indent: string, prefix: string[] = []): string {
    const inner = `${indent}  `;
    const lines = [...prefix.map((p) => `${inner}${p}`), this.statements(list, inner)].filter((l) => l !== "");
    return `(${params}) => {\n${lines.join("\n")}\n${indent}}`;
  }

  private statement(s: Stmt, indent: string): string {
    switch (s.kind) {
      case "log":
        return `${indent}console.log(${renderExpr(s.e)});`;
      case "nextTick":
        return `${indent}process.nextTick(${this.callback("", s.body, indent)});`;
      case "microtask":
        return `${indent}queueMicrotask(${this.callback("", s.body, indent)});`;
      case "timeout":
        return `${indent}setTimeout(${this.callback("", s.body, indent)}, ${s.delay});`;
      case "chain":
        return this.chain(s, indent);
      case "async":
        return this.asyncFunction(s, indent);
      default:
        return assertNever(s);
    }
  }

  private chain(s: Extract<Stmt, { kind: "chain" }>, indent: string): string {
    const head = s.head.kind === "resolve" ? `Promise.resolve(${s.head.n})` : `Promise.reject(new Error(${JSON.stringify(s.head.message)}))`;
    const inner = `${indent}  `;
    const links = s.links.map((l) => {
      switch (l.kind) {
        case "then":
          return `${inner}.then(${this.callback("v", l.body, inner, ["console.log(v);"])})`;
        case "throw":
          return `${inner}.then(() => {\n${inner}  throw new Error(${JSON.stringify(l.message)});\n${inner}})`;
        case "catch":
          return `${inner}.catch(${this.callback("e", l.body, inner, ["console.log(e.message);"])})`;
        case "finally":
          return `${inner}.finally(${this.callback("", l.body, inner)})`;
        default:
          return assertNever(l);
      }
    });
    // A rejection must always end in a handler: an unhandled one exits 1 with a stack trace.
    links.push(`${inner}.catch(() => {})`);
    return `${indent}${head}\n${links.join("\n")};`;
  }

  private asyncFunction(s: Extract<Stmt, { kind: "async" }>, indent: string): string {
    const name = `f${this.functions++}`;
    const inner = `${indent}  `;
    const lines = s.items.map((item) => {
      switch (item.kind) {
        case "log":
          return `${inner}console.log(${renderExpr(item.e)});`;
        case "await":
          if (item.what === "value") return `${inner}await ${item.n};`;
          if (item.what === "resolved") return `${inner}await Promise.resolve(${item.n});`;
          return `${inner}await { then(resolve) { resolve(${item.n}); } };`;
        case "awaitReject":
          return `${inner}try {\n${inner}  await Promise.reject(new Error(${JSON.stringify(item.message)}));\n${inner}} catch (e) {\n${inner}  console.log(e.message);\n${inner}}`;
        default:
          return assertNever(item);
      }
    });
    return `${indent}async function ${name}() {\n${lines.join("\n")}\n${indent}}\n${indent}${name}();`;
  }
}

export function renderProgram(program: Program): string {
  return new Renderer().program(program);
}

/** Rendered source; shrinks through the model (drop a statement, flatten a callback, simplify a value). */
export const programArbitrary: fc.Arbitrary<string> = programModelArbitrary.map(renderProgram);

/** True when some timer callback (transitively) creates a timer: the generator must never produce one. */
export function createsTimerInsideTimer(program: Program): boolean {
  const visit = (list: readonly Stmt[], inTimer: boolean): boolean =>
    list.some((s) => {
      switch (s.kind) {
        case "timeout":
          return inTimer || visit(s.body, true);
        case "nextTick":
        case "microtask":
          return visit(s.body, inTimer);
        case "chain":
          return s.links.some((l) => l.kind !== "throw" && visit(l.body, inTimer));
        case "log":
        case "async":
          return false;
        default:
          return assertNever(s);
      }
    });
  return visit(program, false);
}

// ---- reduction -------------------------------------------------------------------------------------

function listReductions(list: readonly Stmt[], minLength: number): Stmt[][] {
  const out: Stmt[][] = [];
  list.forEach((s, i) => {
    const before = list.slice(0, i);
    const after = list.slice(i + 1);
    if (list.length > minLength) out.push([...before, ...after]);
    // Replace a callback statement by the statements of its body.
    if (s.kind === "nextTick" || s.kind === "microtask" || s.kind === "timeout") out.push([...before, ...s.body, ...after]);
    for (const reduced of stmtReductions(s)) out.push([...before, reduced, ...after]);
  });
  return out;
}

function stmtReductions(s: Stmt): Stmt[] {
  switch (s.kind) {
    case "log":
      return [];
    case "nextTick":
    case "microtask":
    case "timeout":
      return listReductions(s.body, 1).map((body): Stmt => ({ ...s, body }));
    case "async":
      return s.items.length > 1 ? s.items.map((_, i): Stmt => ({ ...s, items: s.items.filter((__, j) => j !== i) })) : [];
    case "chain": {
      const out: Stmt[] = [];
      if (s.links.length > 1) s.links.forEach((_, i) => out.push({ ...s, links: s.links.filter((__, j) => j !== i) }));
      s.links.forEach((l, i) => {
        if (l.kind === "throw") return;
        for (const body of listReductions(l.body, 1)) {
          out.push({ ...s, links: s.links.map((x, j): Link => (j === i ? { ...l, body } : x)) });
        }
      });
      return out;
    }
    default:
      return assertNever(s);
  }
}

/**
 * fast-check's array shrinker only drops items from the front, so a shrunk counterexample can
 * keep irrelevant trailing statements. This greedily applies single-step reductions (drop a
 * statement, link or await; replace a callback by its body) for as long as `stillFails` holds.
 */
export function minimizeProgram(program: Program, stillFails: (source: string) => boolean): Program {
  let current = program;
  for (let progress = true; progress; ) {
    progress = false;
    for (const candidate of listReductions(current, 1)) {
      if (stillFails(renderProgram(candidate))) {
        current = candidate;
        progress = true;
        break;
      }
    }
  }
  return current;
}
