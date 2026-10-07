import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { parseScript } from "./parse";

function parsed(source: string) {
  const r = parseScript(source);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

function failed(source: string): Diagnostic[] {
  const r = parseScript(source);
  if (r.ok) throw new Error("expected diagnostics, got a program");
  return r.error;
}

describe("parseScript: recovered errors are diagnostics", () => {
  it("a redeclared let is one E_SYNTAX at the second identifier, never an ok result", () => {
    const source = "let x; let x;";
    const d = failed(source);
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe("E_SYNTAX");
    expect(d[0]?.message).toContain("Identifier 'x' has already been declared");
    expect(d[0]?.range).toEqual({ start: 11, end: 12 });
    expect(source.slice(d[0]?.range.start, d[0]?.range.end)).toBe("x");
    expect(d[0]?.hint.length).toBeGreaterThan(0);
  });

  it("an invalid assignment target is a diagnostic", () => {
    const d = failed("1 = 2");
    expect(d[0]?.code).toBe("E_SYNTAX");
    expect(d[0]?.message).toContain("Invalid left-hand side");
    expect(d[0]?.range.start).toBe(0);
  });

  it("top-level await and import are diagnostics whose hint points at the subset document", () => {
    for (const source of ["await 1", 'import x from "y"', "export const a = 1"]) {
      const d = failed(source);
      expect(d[0]?.code).toBe("E_SYNTAX");
      expect(d[0]?.hint).toContain("SUPPORTED_SUBSET.md");
    }
  });

  it("reports every recovered error, in source order", () => {
    const d = failed("let a; let a;\n1 = 2;");
    expect(d.map((x) => x.range.start)).toEqual([11, 14]);
  });

  it("an unrecoverable syntax error is a diagnostic too", () => {
    const d = failed("let = ;");
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe("E_SYNTAX");
  });

  it("offsets are UTF-16 code units: an astral character before the error counts as two", () => {
    const source = '"😀"; let y = 1; let y;';
    const d = failed(source);
    expect(source.slice(d[0]?.range.start, d[0]?.range.end)).toBe("y");
    expect(d[0]?.range.start).toBe(source.lastIndexOf("y"));
  });
});

describe("parseScript: valid scripts", () => {
  it("accepts a top-level return (the CommonJS wrapper is a function)", () => {
    const p = parsed("return 1");
    expect(p.ast.body).toHaveLength(1);
    expect(p.ast.body[0]?.type).toBe("ReturnStatement");
  });

  it("parses empty and comment-only sources to an empty program", () => {
    expect(parsed("").ast.body).toEqual([]);
    expect(parsed("// nothing here\n/* or here */").ast.body).toEqual([]);
  });

  it("produces ESTree (a Literal, not a StringLiteral) with ranges", () => {
    const p = parsed("let s = 'a';");
    const decl = p.ast.body[0];
    expect(decl?.type).toBe("VariableDeclaration");
    if (decl?.type === "VariableDeclaration") {
      const init = decl.declarations[0]?.init;
      expect(init?.type).toBe("Literal");
      expect(init?.range).toEqual([8, 11]);
    }
  });

  it("keeps the source text on the result", () => {
    expect(parsed("let a = 1;").source).toBe("let a = 1;");
  });
});

describe("parseScript: strictness", () => {
  it("is strict with a leading 'use strict' directive (either quote style)", () => {
    expect(parsed("'use strict'; var a").strict).toBe(true);
    expect(parsed('"use strict"; var a').strict).toBe(true);
    expect(parsed("// c\n'use strict';").strict).toBe(true);
  });

  it("is sloppy without one, or when the directive is not first", () => {
    expect(parsed("var a;").strict).toBe(false);
    expect(parsed("var a; 'use strict';").strict).toBe(false);
    expect(parsed("function f() { 'use strict' }").strict).toBe(false);
  });

  it("does not accept an escaped spelling as a directive", () => {
    expect(parsed("'use\\x20strict'; var a").strict).toBe(false);
  });

  it("applies strict-mode early errors once strict", () => {
    expect(failed("'use strict'; with (a) {}")[0]?.code).toBe("E_SYNTAX");
    expect(parsed("with (a) {}").strict).toBe(false);
  });
});

describe("parseScript: byte order mark", () => {
  it("rejects a leading BOM with a message telling the caller to strip it", () => {
    const d = failed("﻿let a = 1;");
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe("E_SYNTAX");
    expect(d[0]?.message).toMatch(/byte order mark/i);
    expect(d[0]?.hint).toMatch(/strip/i);
    expect(d[0]?.range).toEqual({ start: 0, end: 1 });
  });
});
