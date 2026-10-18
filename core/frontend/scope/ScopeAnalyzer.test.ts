import type { Identifier, Node } from "estree";
import { describe, expect, it } from "vitest";
import { childNodes } from "../ast";
import { parseScript } from "../parse";
import type { ReferenceInfo, Scope, ScopeTree, Variable } from "./Scope";
import { analyzeScopes } from "./ScopeAnalyzer";

function analyze(source: string): ScopeTree {
  const parsed = parseScript(source);
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`);
  return analyzeScopes(parsed.value);
}

/** The function scope created for `function name(...) {}` / `function name() {}` expression, found by node id. */
function fnScope(tree: ScopeTree, name: string): Scope {
  const found = tree.scopes.find(
    (s) =>
      s.kind === "function" &&
      (s.node.type === "FunctionDeclaration" || s.node.type === "FunctionExpression") &&
      s.node.id?.name === name,
  );
  if (!found) throw new Error(`no function scope for ${name}`);
  return found;
}

function variable(scope: Scope, name: string): Variable {
  const v = scope.variables.find((x) => x.name === name);
  if (!v) throw new Error(`no variable ${name} in ${scope.kind} scope (has ${scope.variables.map((x) => x.name)})`);
  return v;
}

function refs(tree: ScopeTree, name: string): ReferenceInfo[] {
  return tree.references.filter((r) => r.name === name);
}

describe("root scope: the CommonJS wrapper function", () => {
  it("declares exports, require, module, __filename, __dirname as parameters 0..4", () => {
    const tree = analyze("");
    expect(tree.root.kind).toBe("function");
    expect(tree.root.parent).toBeNull();
    expect(tree.root.variables.map((v) => [v.name, v.kind, v.allocation])).toEqual([
      ["exports", "param", { kind: "parameter", index: 0 }],
      ["require", "param", { kind: "parameter", index: 1 }],
      ["module", "param", { kind: "parameter", index: 2 }],
      ["__filename", "param", { kind: "parameter", index: 3 }],
      ["__dirname", "param", { kind: "parameter", index: 4 }],
    ]);
  });

  it("is strict only with a leading directive", () => {
    expect(analyze("var a").root.strict).toBe(false);
    expect(analyze("'use strict'; var a").root.strict).toBe(true);
  });

  it("per-function strictness: a directive inside a function makes only that function strict", () => {
    const tree = analyze("function a(){ 'use strict' }\nfunction b(){}");
    expect(fnScope(tree, "a").strict).toBe(true);
    expect(fnScope(tree, "b").strict).toBe(false);
  });
});

describe("hoisting", () => {
  it("resolves a call before its function declaration to the hoisted function binding", () => {
    const tree = analyze("f();\nfunction f() {}");
    const [r] = refs(tree, "f");
    expect(r?.resolved).not.toBe("global");
    expect((r?.resolved as Variable).kind).toBe("function");
    expect(r?.needsTdzCheck).toBe(false);
  });

  it("hoists var to the function scope, with no TDZ check even when read before the initializer", () => {
    const tree = analyze("x; var x = 1;");
    const [r] = refs(tree, "x");
    expect((r?.resolved as Variable).kind).toBe("var");
    expect((r?.resolved as Variable).scope).toBe(tree.root);
    expect(r?.needsTdzCheck).toBe(false);
  });

  it("hoists a var declared in a nested block to the function scope and makes no block scope for it", () => {
    const tree = analyze("if (true) { var v = 1; }\nv;");
    expect(variable(tree.root, "v").kind).toBe("var");
    expect(tree.scopes.filter((s) => s.kind === "block")).toHaveLength(0);
  });

  it("hoists let to its block, so it is not visible outside it", () => {
    const tree = analyze("{ let a = 1; }\na;");
    const block = tree.scopes.find((s) => s.kind === "block");
    expect(block?.variables.map((v) => v.name)).toEqual(["a"]);
    expect(refs(tree, "a")[0]?.resolved).toBe("global");
  });

  it("creates no scope for a block without lexical declarations", () => {
    const tree = analyze("{ 1; }\nif (1) { 2; }");
    expect(tree.scopes).toHaveLength(1);
  });

  it("Annex B: a sloppy block function also gets a function-level var binding", () => {
    const tree = analyze("{ function h() {} }\nh;");
    const target = refs(tree, "h")[0]?.resolved as Variable;
    expect(target.kind).toBe("var");
    expect(target.annexB).toBe(true);
    expect(target.scope).toBe(tree.root);
    const block = tree.scopes.find((s) => s.kind === "block");
    expect(variable(block as Scope, "h").kind).toBe("function");
  });

  it("Annex B does not apply in strict code", () => {
    const tree = analyze("'use strict';\n{ function h() {} }\nh;");
    expect(refs(tree, "h")[0]?.resolved).toBe("global");
  });

  it("Annex B is skipped when an enclosing let of the same name would be crossed", () => {
    const tree = analyze("{ let h = 1; { function h() {} } }\nh;");
    expect(refs(tree, "h")[0]?.resolved).toBe("global");
  });

  it("a var with the same name as a function declaration is the same binding", () => {
    const tree = analyze("var f; function f() {}");
    expect(tree.root.variables.filter((v) => v.name === "f")).toHaveLength(1);
    expect(variable(tree.root, "f").kind).toBe("function");
  });
});

describe("temporal dead zone", () => {
  it("needs a check when read before the let initializer", () => {
    expect(refs(analyze("x; let x = 1;"), "x")[0]?.needsTdzCheck).toBe(true);
  });

  it("needs no check when read after the initializer in the same closure", () => {
    expect(refs(analyze("let x = 1; x;"), "x")[0]?.needsTdzCheck).toBe(false);
  });

  it("needs a check when the initializer reads the variable itself", () => {
    expect(refs(analyze("let x = x + 1;"), "x")[0]?.needsTdzCheck).toBe(true);
  });

  it("needs no check after `let x;` (no initializer) or after a const", () => {
    expect(refs(analyze("let x; x;"), "x")[0]?.needsTdzCheck).toBe(false);
    expect(refs(analyze("const c = 1; c;"), "c")[0]?.needsTdzCheck).toBe(false);
  });

  it("keeps the check for a closure use, whether the closure is written before or after the declaration", () => {
    expect(refs(analyze("function g() { return x; }\nlet x = 1;"), "x")[0]?.needsTdzCheck).toBe(true);
    expect(refs(analyze("let x = 1;\nfunction g() { return x; }"), "x")[0]?.needsTdzCheck).toBe(true);
  });

  it("checks a parameter read from an earlier default expression", () => {
    const tree = analyze("function f(a = b, b) { return b; }");
    const [inDefault, inBody] = refs(tree, "b");
    expect(inDefault?.needsTdzCheck).toBe(true);
    expect(inBody?.needsTdzCheck).toBe(false);
  });

  it("never checks var, function or simple parameters", () => {
    const tree = analyze("function f(a, b) { var c = a + b; return c; }");
    for (const r of tree.references) expect(r.needsTdzCheck).toBe(false);
  });
});

describe("allocation: registers, context slots, parameters", () => {
  it("context-allocates exactly the variables an inner function references", () => {
    const tree = analyze("function counter() { let n = 0; let unused = 1; return () => ++n; }");
    const counter = fnScope(tree, "counter");
    const n = variable(counter, "n");
    expect(n.captured).toBe(true);
    expect(n.allocation).toEqual({ kind: "context", index: 0 });
    expect(variable(counter, "unused").captured).toBe(false);
    expect(variable(counter, "unused").allocation).toEqual({ kind: "register", index: 0 });
    expect(counter.needsContext).toBe(true);
    expect(counter.contextSlots).toBe(1);
  });

  it("numbers context slots in declaration order and registers independently", () => {
    const tree = analyze("function f() { let a = 1; let b = 2; let c = 3; return () => c + a; }");
    const f = fnScope(tree, "f");
    expect(variable(f, "a").allocation).toEqual({ kind: "context", index: 0 });
    expect(variable(f, "b").allocation).toEqual({ kind: "register", index: 0 });
    expect(variable(f, "c").allocation).toEqual({ kind: "context", index: 1 });
    expect(f.contextSlots).toBe(2);
    expect(f.stackSlots).toBe(1);
  });

  it("a function that captures nothing needs no context", () => {
    const f = fnScope(analyze("function f() { let a = 1; return a; }"), "f");
    expect(f.needsContext).toBe(false);
    expect(f.contextSlots).toBe(0);
  });

  it("registers are numbered function-wide: own locals first, then inner blocks last to first (as V8 prints it)", () => {
    const tree = analyze("let a = 1;\n{ let b = 2; }\n{ let c = 3; }\nlet d = 4;");
    const [blockB, blockC] = tree.scopes.filter((s) => s.kind === "block");
    expect(variable(tree.root, "a").allocation).toEqual({ kind: "register", index: 0 });
    expect(variable(tree.root, "d").allocation).toEqual({ kind: "register", index: 1 });
    expect(variable(blockC as Scope, "c").allocation).toEqual({ kind: "register", index: 2 });
    expect(variable(blockB as Scope, "b").allocation).toEqual({ kind: "register", index: 3 });
    expect(tree.root.stackSlots).toBe(4);
  });

  it("a nested function has its own register numbering", () => {
    const tree = analyze("let outer = 1;\nfunction g() { let inner = 2; return inner; }");
    expect(variable(fnScope(tree, "g"), "inner").allocation).toEqual({ kind: "register", index: 0 });
  });

  it("parameters are `parameter` allocations unless captured, then they move to the context", () => {
    const tree = analyze("function f(p, q) { return () => p; }");
    const f = fnScope(tree, "f");
    expect(variable(f, "q").allocation).toEqual({ kind: "parameter", index: 1 });
    const p = variable(f, "p");
    expect(p.allocation).toEqual({ kind: "context", index: 0 });
    expect(p.parameterIndex).toBe(0);
  });

  it("a captured top-level variable is context-allocated in the wrapper scope", () => {
    const tree = analyze("let n = 0;\nfunction inc() { n++; }");
    expect(variable(tree.root, "n").allocation).toEqual({ kind: "context", index: 0 });
    expect(tree.root.needsContext).toBe(true);
  });

  it("a captured wrapper parameter is context-allocated and remembers its parameter index", () => {
    const tree = analyze("function f() { return module; }");
    const m = variable(tree.root, "module");
    expect(m.allocation).toEqual({ kind: "context", index: 0 });
    expect(m.parameterIndex).toBe(2);
  });

  it("a variable captured from a block gives that block a context", () => {
    const tree = analyze("{ let j = 1; setTimeout(() => j); }");
    const block = tree.scopes.find((s) => s.kind === "block") as Scope;
    expect(block.needsContext).toBe(true);
    expect(variable(block, "j").allocation).toEqual({ kind: "context", index: 0 });
    expect(tree.root.needsContext).toBe(false);
  });

  it("an arrow referencing an outer variable captures it just like a function does", () => {
    const tree = analyze("let a = 1; const f = () => a;");
    expect(variable(tree.root, "a").captured).toBe(true);
  });

  it("a named function expression's own name is a register copied from the closure", () => {
    const tree = analyze("const f = function g() { return g; };");
    const g = refs(tree, "g")[0]?.resolved as Variable;
    expect(g.kind).toBe("function-name");
    expect(g.allocation).toEqual({ kind: "register", index: 0 });
  });

  it("a parameter or var named like the function expression shadows its name", () => {
    const tree = analyze("const f = function g(g) { return g; };");
    expect((refs(tree, "g")[0]?.resolved as Variable).kind).toBe("param");
  });
});

describe("loops", () => {
  it("a for-let with a closure in it is desugared: the closure sees a per-iteration copy (V8 DesugarLexicalBindingsInForStatement)", () => {
    const tree = analyze("const fns = [];\nfor (let i = 0; i < 3; i++) { fns.push(() => i); }");
    const loop = tree.scopes.find((s) => s.node.type === "ForStatement") as Scope;
    expect(loop.kind).toBe("block");
    expect(loop.perIteration).toBe(true);
    const iteration = loop.iteration;
    if (!iteration) throw new Error("no per-iteration scope");
    expect(iteration.scope.parent).toBe(loop);
    // The `.for` temporaries are function locals declared after the loop, ahead of block-scope locals.
    expect(iteration.temporaries.map((t) => t.allocation)).toEqual([{ kind: "register", index: 1 }]);
    expect(iteration.first?.allocation).toEqual({ kind: "register", index: 2 });
    expect(iteration.flag.allocation).toEqual({ kind: "register", index: 3 });
    expect(variable(loop, "i").allocation).toEqual({ kind: "register", index: 4 });
    expect(iteration.copies.map((c) => c.allocation)).toEqual([{ kind: "context", index: 0 }]);
    expect(iteration.scope.needsContext).toBe(true);
    const closureRead = refs(tree, "i").at(-1);
    expect(closureRead?.resolved).toBe(iteration.copies[0]);
  });

  it("a for-let with no update has no first-iteration flag", () => {
    const tree = analyze("for (let i = 0; i < 3; ) { (() => i)(); i++; }");
    const loop = tree.scopes.find((s) => s.node.type === "ForStatement") as Scope;
    expect(loop.iteration?.first).toBeNull();
  });

  it("a for-let with a closure that does not capture the variable is still desugared, without a context", () => {
    const tree = analyze("for (let i = 0; i < 3; i++) { (() => 1)(); }");
    const loop = tree.scopes.find((s) => s.node.type === "ForStatement") as Scope;
    expect(loop.perIteration).toBe(true);
    expect(loop.iteration?.scope.needsContext).toBe(false);
    expect(loop.iteration?.copies[0]?.allocation.kind).toBe("register");
  });

  it("an uncaptured for-let variable is a plain register with no per-iteration copy", () => {
    const tree = analyze("for (let i = 0; i < 3; i++) { i; }");
    const loop = tree.scopes.find((s) => s.node.type === "ForStatement") as Scope;
    expect(loop.perIteration).toBe(false);
    expect(variable(loop, "i").allocation).toEqual({ kind: "register", index: 0 });
  });

  it("a let in a loop body that a closure captures gets a block context of its own", () => {
    const tree = analyze("for (var k = 0; k < 2; k++) { let j = k; setTimeout(() => j); }");
    const body = tree.scopes.find((s) => s.node.type === "BlockStatement") as Scope;
    expect(body.needsContext).toBe(true);
    expect(variable(body, "j").allocation).toEqual({ kind: "context", index: 0 });
  });

  it("a for-var loop declares its variable in the function scope", () => {
    const tree = analyze("for (var k = 0; k < 2; k++) {}");
    expect(variable(tree.root, "k").kind).toBe("var");
    expect(tree.scopes).toHaveLength(1);
  });
});

describe("catch", () => {
  it("binds the catch parameter in a catch scope that ends with the clause", () => {
    const tree = analyze("try {} catch (e) { e; }\ne;");
    const scope = tree.scopes.find((s) => s.kind === "catch") as Scope;
    expect(scope.variables.map((v) => [v.name, v.kind])).toEqual([["e", "catch"]]);
    const [inside, outside] = refs(tree, "e");
    expect(inside?.resolved).toBe(scope.variables[0]);
    expect(outside?.resolved).toBe("global");
  });

  it("context-allocates a captured catch parameter", () => {
    const tree = analyze("try {} catch (e) { setTimeout(() => e); }");
    const scope = tree.scopes.find((s) => s.kind === "catch") as Scope;
    expect(scope.needsContext).toBe(true);
    expect(variable(scope, "e").allocation).toEqual({ kind: "context", index: 0 });
  });

  it("context-allocates the catch parameter even when nothing captures it (V8: catch-bound variables always live in the context)", () => {
    const tree = analyze("try {} catch (e) { e; }");
    const scope = tree.scopes.find((s) => s.kind === "catch") as Scope;
    expect(scope.needsContext).toBe(true);
    expect(scope.contextSlots).toBe(1);
    expect(variable(scope, "e").allocation).toEqual({ kind: "context", index: 0 });
    expect(variable(scope, "e").captured).toBe(false);
  });

  it("gives an unused catch parameter its slot too, and takes no register for it", () => {
    const tree = analyze("function f() { try {} catch (e) {} let x = 1; return x; }");
    const scope = tree.scopes.find((s) => s.kind === "catch") as Scope;
    expect(variable(scope, "e").allocation).toEqual({ kind: "context", index: 0 });
    expect(variable(fnScope(tree, "f"), "x").allocation).toEqual({ kind: "register", index: 0 });
  });

  it("a catch without a parameter creates no scope", () => {
    expect(analyze("try {} catch { 1; }").scopes.filter((s) => s.kind === "catch")).toHaveLength(0);
  });
});

describe("globals and shadowing", () => {
  it("resolves unresolved names to global", () => {
    const tree = analyze("console.log(1); setTimeout(function () {}, 0);");
    expect(refs(tree, "console")[0]?.resolved).toBe("global");
    expect(refs(tree, "setTimeout")[0]?.resolved).toBe("global");
  });

  it("does not treat property names or object keys as references", () => {
    const tree = analyze("const o = { a: 1, b() {} }; o.c; o.d = 1;");
    expect(tree.references.map((r) => r.name).sort()).toEqual(["o", "o"]);
  });

  it("does not treat labels as references", () => {
    const tree = analyze("lbl: for (;;) { break lbl; }");
    expect(tree.references).toHaveLength(0);
  });

  it("a local let shadows a global of the same name", () => {
    const tree = analyze("let Date = 1; Date;");
    expect((refs(tree, "Date")[0]?.resolved as Variable).kind).toBe("let");
  });

  it("a parameter shadows a global only inside its function", () => {
    const tree = analyze("function f(Date) { return Date; }\nDate;");
    const [inside, outside] = refs(tree, "Date");
    expect((inside?.resolved as Variable).kind).toBe("param");
    expect(outside?.resolved).toBe("global");
  });

  it("an inner binding shadows an outer one", () => {
    const tree = analyze("let a = 1;\nfunction f() { let a = 2; return a; }");
    const [inner] = refs(tree, "a");
    expect((inner?.resolved as Variable).scope).toBe(fnScope(tree, "f"));
    expect(variable(tree.root, "a").captured).toBe(false);
  });

  it("duplicate parameters in sloppy mode: the last one wins and nothing throws", () => {
    const tree = analyze("function f(a, a) { return a; }");
    const f = fnScope(tree, "f");
    expect(f.variables.filter((v) => v.name === "a")).toHaveLength(1);
    expect(variable(f, "a").allocation).toEqual({ kind: "parameter", index: 1 });
    expect(f.parameterNames).toEqual(["a", "a"]);
  });
});

describe("reference details", () => {
  it("records read, write and read-write access", () => {
    const tree = analyze("let a = 0; a = 1; a++; a += 2; a;");
    expect(refs(tree, "a").map((r) => r.access)).toEqual(["write", "readwrite", "readwrite", "read"]);
  });

  it("a declaration initializer is not a reference", () => {
    expect(analyze("let a = 1; var b = 2;").references).toHaveLength(0);
  });

  it("flags names used as `typeof` operands", () => {
    const tree = analyze("typeof undeclared; typeof (undeclared2); typeof (0, undeclared3); typeof undeclared4.x;");
    expect(refs(tree, "undeclared")[0]?.inTypeof).toBe(true);
    // Parentheses are transparent: `typeof (x)` still must not throw for an unresolvable x.
    expect(refs(tree, "undeclared2")[0]?.inTypeof).toBe(true);
    expect(refs(tree, "undeclared3")[0]?.inTypeof).toBe(false);
    expect(refs(tree, "undeclared4")[0]?.inTypeof).toBe(false);
  });

  it("each reference carries the range of its identifier", () => {
    const source = "let abc = 1;\nabc;";
    const r = refs(analyze(source), "abc")[0];
    expect(source.slice(r?.range.start, r?.range.end)).toBe("abc");
  });

  it("variables carry the range of their declaring identifier", () => {
    const source = "let abc = 1;";
    const v = variable(analyze(source).root, "abc");
    expect(source.slice(v.declaredAt.start, v.declaredAt.end)).toBe("abc");
  });

  it("references are listed in source order", () => {
    const tree = analyze("a; b; function f() { c; } d;");
    expect(tree.references.map((r) => r.name)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("lookup maps", () => {
  it("maps every identifier node to its reference or declaration, and every scope node to its scope", () => {
    const tree = analyze("let a = 1; function f(p) { return a + p; }");
    const seenRefs = new Set<Node>();
    const seenDecls = new Set<Node>();
    const walk = (n: Node) => {
      if (n.type === "Identifier") {
        if (tree.referenceOf.has(n)) seenRefs.add(n);
        if (tree.declarationOf.has(n)) seenDecls.add(n);
      }
      for (const c of childNodes(n)) walk(c);
    };
    walk(tree.root.node);
    expect([...seenRefs].map((n) => (n as Identifier).name).sort()).toEqual(["a", "p"]);
    expect([...seenDecls].map((n) => (n as Identifier).name).sort()).toEqual(["a", "f", "p"]);
    expect(tree.scopeOf.get(tree.root.node)).toBe(tree.root);
    expect(tree.scopeOf.get(fnScope(tree, "f").node)).toBe(fnScope(tree, "f"));
  });
});

describe("allocation: variables nothing uses", () => {
  // V8 gives a stack slot only to a variable some code names: a reference, or the initialization
  // `var x = 1` / `let x;` makes. (Read off `--print-bytecode`: the unused ones take no register.)
  it("gives no register to a bare var, an unreferenced function or a never-named variable", () => {
    const tree = analyze("var u; var a = 1; function g() {} var b = 2;");
    expect(variable(tree.root, "u").allocation).toEqual({ kind: "unused" });
    expect(variable(tree.root, "g").allocation).toEqual({ kind: "unused" });
    expect(variable(tree.root, "a").allocation).toEqual({ kind: "register", index: 0 });
    expect(variable(tree.root, "b").allocation).toEqual({ kind: "register", index: 1 });
    expect(tree.root.stackSlots).toBe(2);
  });

  it("allocates a bare declaration once it is assigned or read, and let x; always", () => {
    const tree = analyze("var r; r = 2; var q; q; let x; var p; var p = 3;");
    expect(variable(tree.root, "r").allocation).toEqual({ kind: "register", index: 0 });
    expect(variable(tree.root, "q").allocation).toEqual({ kind: "register", index: 1 });
    expect(variable(tree.root, "x").allocation).toEqual({ kind: "register", index: 2 });
    expect(variable(tree.root, "p").allocation).toEqual({ kind: "register", index: 3 });
  });

  it("allocates the variable of a for-in or for-of loop and a called function", () => {
    const tree = analyze("var o; for (var k in o) {} function f() {} f();");
    expect(variable(tree.root, "o").allocation).toEqual({ kind: "register", index: 0 });
    expect(variable(tree.root, "k").allocation).toEqual({ kind: "register", index: 1 });
    expect(variable(tree.root, "f").allocation).toEqual({ kind: "register", index: 2 });
  });
});

describe("break and continue inside an arrow", () => {
  it("do not make the enclosing function keep a receiver in its context", () => {
    const tree = analyze("function f() { var g = () => { for (;;) { if (1) continue; break; } }; g(); }");
    expect(fnScope(tree, "f").thisVariable).toBeNull();
    expect(tree.thisOf.size).toBe(0);
  });

  it("an arrow that does read this still does", () => {
    const tree = analyze("function f() { var g = () => this; g(); }");
    expect(fnScope(tree, "f").thisVariable?.captured).toBe(true);
  });
});

describe("async functions", () => {
  it("marks async function scopes and counts their awaits (V8 suspend_count)", () => {
    const tree = analyze("async function f() { await 1; await 2; }\nfunction g() {}\nasync function h() { }");
    expect(fnScope(tree, "f").isAsync).toBe(true);
    expect(fnScope(tree, "f").suspendCount).toBe(2);
    expect(fnScope(tree, "g").isAsync).toBe(false);
    expect(fnScope(tree, "h").suspendCount).toBe(0);
  });

  it("counts an await for the function that contains it, not the one enclosing that", () => {
    const tree = analyze("async function outer() { const inner = async () => { await 1; }; return inner; }");
    expect(fnScope(tree, "outer").suspendCount).toBe(0);
    const arrow = tree.scopes.find((s) => s.node.type === "ArrowFunctionExpression") as Scope;
    expect(arrow.isAsync).toBe(true);
    expect(arrow.suspendCount).toBe(1);
  });

  it("reserves register 0 for the generator object, before the function's locals", () => {
    const tree = analyze("async function f() { var v = 1; let l = 2; return v + l; }");
    const f = fnScope(tree, "f");
    expect(variable(f, "v").allocation).toEqual({ kind: "register", index: 1 });
    expect(variable(f, "l").allocation).toEqual({ kind: "register", index: 2 });
    expect(f.stackSlots).toBe(3);
  });

  it("an async function without locals still holds the generator object", () => {
    expect(fnScope(analyze("async function f() {}"), "f").stackSlots).toBe(1);
  });

  it("a plain function keeps register 0 for its first local", () => {
    const f = fnScope(analyze("function f() { let a = 1; return a; }"), "f");
    expect(variable(f, "a").allocation).toEqual({ kind: "register", index: 0 });
  });
});
