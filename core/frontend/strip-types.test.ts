import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { stripTypes } from "./strip-types";

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const LINE_BREAK = new RegExp(`\\r\\n|\\n|\\r|${LS}|${PS}`, "g");

function stripped(source: string): string {
  const r = stripTypes(source);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

function refused(source: string): Diagnostic[] {
  const r = stripTypes(source);
  if (r.ok) throw new Error(`expected refusal, got ${JSON.stringify(r.value)}`);
  return r.error;
}

describe("stripTypes: erasure keeps every code unit in place", () => {
  it("replaces annotations and `as` casts with spaces", () => {
    expect(stripped("const x: number = 1 as number;")).toBe("const x         = 1          ;");
  });

  it("erases interfaces, type aliases and ambient declarations entirely", () => {
    const src = "interface P { x: number }\ntype Id = string | number;\ndeclare const a: number;\nlet y = 1;";
    const out = stripped(src);
    expect(out.length).toBe(src.length);
    expect(out.split("\n").map((l) => l.trim())).toEqual(["", "", "", "let y = 1;"]);
  });

  it("erases type parameters, type arguments and return types", () => {
    expect(stripped("function f<T>(v: T): T { return v }\nf<number>(1);")).toBe(
      "function f   (v   )    { return v }\nf        (1);",
    );
    expect(stripped("const g = <T>(v: T): T => v;")).toBe("const g =    (v   )    => v;");
  });

  it("erases optional markers, non-null assertions and satisfies", () => {
    expect(stripped("function f(a?: number) {}")).toBe("function f(a         ) {}");
    expect(stripped("a!.b;")).toBe("a .b;");
    expect(stripped("const c = { r: 1 } satisfies { r: number };")).toBe(`const c = { r: 1 }${" ".repeat(24)};`);
  });

  it("erases a `this` parameter together with its comma", () => {
    expect(stripped("function f(this: X, a) {}")).toBe("function f(         a) {}");
  });

  it("erases class-only syntax: modifiers, implements, abstract members, index signatures", () => {
    const src = [
      "abstract class A<T> extends B<T> implements I {",
      "  private readonly x?: number;",
      "  y!: string;",
      "  abstract m(): void;",
      "  [k: string]: any;",
      "  static s = 1;",
      "}",
    ].join("\n");
    const out = stripped(src);
    expect(out.length).toBe(src.length);
    for (const word of ["abstract", "private", "readonly", "implements", "number", "string", "void", "any"]) {
      expect(out).not.toContain(word);
    }
    expect(out).toContain("class A");
    expect(out).toContain("static s = 1;");
    expect(out).toMatch(/y\s*;/);
  });

  it("leaves plain JavaScript untouched", () => {
    const src = "const a = 1 < 2 > 3;\nlet b = a ? (1) : 2;\nlabel: for (;;) { break label }";
    expect(stripped(src)).toBe(src);
  });

  it("keeps CRLF line endings and the total length", () => {
    const src = "interface A {\r\n  x: number;\r\n}\r\nconst y: number = 1;\r\n";
    const out = stripped(src);
    expect(out.length).toBe(src.length);
    expect(out).toBe("             \r\n            \r\n \r\nconst y         = 1;\r\n");
  });

  it("keeps U+2028/U+2029 line terminators inside an erased range", () => {
    const src = `interface A {${LS} x: number;${PS}}\nlet a = 1;`;
    const out = stripped(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain(LS);
    expect(out).toContain(PS);
  });

  it("does not shift offsets after astral characters (UTF-16 units)", () => {
    const src = 'const s: string = "😀"; const t: number = 2;';
    const out = stripped(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain('"😀"');
    expect(out.indexOf("const t")).toBe(src.indexOf("const t"));
    expect(out.indexOf("= 2")).toBe(src.indexOf("= 2"));
  });

  it("works on BOM-less text only: offsets are unchanged when called without a BOM", () => {
    const body = "let a: number = 1;";
    expect(stripped(body).indexOf("= 1")).toBe(body.indexOf("= 1"));
  });

  it("accepts empty and comment-only sources", () => {
    expect(stripped("")).toBe("");
    expect(stripped("// just a comment\n")).toBe("// just a comment\n");
  });

  it("erases a type-only namespace (no runtime members)", () => {
    const src = "namespace N { export interface I { a: 1 } }\nlet z = 1;";
    const out = stripped(src);
    expect(out.length).toBe(src.length);
    expect(out.endsWith("\nlet z = 1;")).toBe(true);
    expect(out).not.toContain("namespace");
  });

  it("reports a TypeScript syntax error as E_SYNTAX at its position", () => {
    const d = refused("const x: = 1;");
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe("E_SYNTAX");
    expect(d[0]?.range.start).toBeGreaterThanOrEqual(8);
  });
});

describe("stripTypes: constructs Node's strip-only mode refuses", () => {
  const cases: { name: string; source: string; text: string; message: RegExp }[] = [
    {
      name: "enum",
      source: "let a = 1;\nenum Color { Red, Green }\nlet b = 2;",
      text: "enum Color { Red, Green }",
      message: /enum is not supported in strip-only mode/,
    },
    {
      name: "const enum",
      source: "const enum E { A }",
      text: "const enum E { A }",
      message: /enum is not supported in strip-only mode/,
    },
    {
      name: "namespace with values",
      source: "namespace U { export const a = 1 }",
      text: "namespace U { export const a = 1 }",
      message: /namespace declaration is not supported in strip-only mode/,
    },
    {
      name: "parameter property",
      source: "class P { constructor(private x: number) {} }",
      text: "private x: number",
      message: /parameter property is not supported in strip-only mode/,
    },
    {
      name: "import-equals",
      source: 'import a = require("a");',
      text: 'import a = require("a");',
      message: /not supported in strip-only mode/,
    },
    {
      name: "export assignment",
      source: "export = 1;",
      text: "export = 1;",
      message: /not supported in strip-only mode/,
    },
    {
      name: "decorator",
      source: "@dec class C {}",
      text: "@dec",
      message: /decorator is not supported in strip-only mode/,
    },
    {
      name: "angle-bracket assertion",
      source: "const v = <number>x;",
      text: "<number>x",
      message: /type assertion is not supported in strip-only mode/,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: one E_TS_UNSUPPORTED diagnostic over the construct, with a hint`, () => {
      const d = refused(c.source);
      expect(d).toHaveLength(1);
      const diag = d[0] as Diagnostic;
      expect(diag.code).toBe("E_TS_UNSUPPORTED");
      expect(diag.message).toMatch(c.message);
      expect(c.source.slice(diag.range.start, diag.range.end)).toBe(c.text);
      expect(diag.hint.length).toBeGreaterThan(10);
    });
  }

  it("reports every refused construct, in source order", () => {
    const d = refused("enum A { X }\nnamespace N { export var v = 1 }");
    expect(d.map((x) => x.range.start)).toEqual([0, 13]);
  });
});

describe("stripTypes: properties", () => {
  const typeText = fc.constantFrom(
    "number",
    "string",
    "boolean",
    "Array<number>",
    "{ a: 1 | 2 }",
    "[string, number]",
    "unknown",
  );
  const snippet = (t: string): fc.Arbitrary<string> =>
    fc.constantFrom(
      `const v: ${t} = null as unknown as ${t};`,
      `function f<T extends ${t}>(a: T, b?: ${t}): ${t} { return a }`,
      `type A = ${t};\nlet w = 1;`,
      `interface I { p: ${t}; q?: ${t} }\nlet u = f<${t}>(1);`,
      `const o = { k: 1 } satisfies { k: ${t} } as ${t};`,
      `declare let d: ${t};\nlet e = d!;`,
    );

  it("keeps the length and every line terminator for random erasable snippets", () => {
    fc.assert(
      fc.property(
        typeText.chain((t) => fc.array(snippet(t), { minLength: 1, maxLength: 4 })),
        fc.constantFrom("\n", "\r\n"),
        (snippets, eol) => {
          const src = snippets.join(eol);
          const r = stripTypes(src);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const lineBreaks = (t: string) => [...t.matchAll(LINE_BREAK)].length;
          expect(r.value.length).toBe(src.length);
          expect(lineBreaks(r.value)).toBe(lineBreaks(src));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never throws for any string", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        stripTypes(s);
      }),
      { numRuns: 300 },
    );
  });
});
