import { parse } from "@babel/parser";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { err, ok, type Result } from "@/core/shared/result";

// Position-preserving TypeScript type stripping, the model of Node's
// `--experimental-strip-types` (amaro/swc "strip-only" mode): every erased
// code unit becomes a space, except line terminators, so the stripped text has
// the same length and the same line structure as the input and every later
// source offset stays valid.
//
// Syntax with a runtime representation (enum, namespace with values, parameter
// properties, import-equals, export-assignment, decorators, `<T>expr`) cannot
// be erased; Node refuses it with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX and so do
// we, with Node's own message text.

type AstNode = { type: string; start: number; end: number; [key: string]: unknown };

const SKIPPED_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "extra",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "errors",
  "tokens",
]);

const ERASE_WHOLE = new Set([
  "TSTypeAnnotation",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSDeclareMethod",
  "TSIndexSignature",
]);

const CLASS_MEMBERS = new Set(["ClassProperty", "ClassPrivateProperty", "ClassAccessorProperty", "ClassMethod", "ClassPrivateMethod"]);
const CLASS_MODIFIERS = ["accessibility", "readonly", "abstract", "override", "declare"] as const;
const FUNCTION_LIKE = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ClassPrivateMethod",
  "ObjectMethod",
]);

const NODE_SUFFIX = "is not supported in strip-only mode";

function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function isLineTerminator(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

/** Statements that vanish completely when erased, so a namespace holding only these is itself erasable. */
function isTypeOnlyStatement(node: AstNode): boolean {
  switch (node.type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSDeclareFunction":
      return true;
    case "ExportNamedDeclaration":
      return isNode(node.declaration) && isTypeOnlyStatement(node.declaration);
    case "TSModuleDeclaration":
      return isTypeOnlyNamespace(node);
    default:
      return false;
  }
}

function isTypeOnlyNamespace(node: AstNode): boolean {
  if (node.declare === true) return true;
  const body = node.body;
  if (!isNode(body)) return true;
  if (body.type === "TSModuleDeclaration") return isTypeOnlyNamespace(body);
  const statements = Array.isArray(body.body) ? body.body : [];
  return statements.every((s) => isNode(s) && isTypeOnlyStatement(s));
}

class Stripper {
  readonly diagnostics: Diagnostic[] = [];
  private readonly erased: Uint8Array;
  /** `source` with every comment blanked to spaces, so keyword and punctuation scans never see comment text. */
  private readonly scan: string;

  constructor(
    private readonly source: string,
    comments: readonly { start: number; end: number }[],
  ) {
    this.erased = new Uint8Array(source.length);
    const chars = source.split("");
    for (const c of comments) {
      for (let i = c.start; i < c.end; i++) if (!isLineTerminator(source.charCodeAt(i))) chars[i] = " ";
    }
    this.scan = chars.join("");
  }

  result(): string {
    const out: string[] = [];
    for (let i = 0; i < this.source.length; i++) {
      const code = this.source.charCodeAt(i);
      out.push(this.erased[i] === 1 && !isLineTerminator(code) ? " " : this.source.charAt(i));
    }
    return out.join("");
  }

  private erase(start: number, end: number): void {
    for (let i = Math.max(start, 0); i < Math.min(end, this.source.length); i++) this.erased[i] = 1;
  }

  private refuse(start: number, end: number, what: string, hint: string): void {
    this.diagnostics.push({
      code: "E_TS_UNSUPPORTED",
      message: `TypeScript ${what} ${NODE_SUFFIX}`,
      range: { start, end },
      hint,
    });
  }

  /** Index of the last non-whitespace code unit before `pos`, or -1. */
  private prevSignificant(pos: number): number {
    let i = pos - 1;
    while (i >= 0 && /\s/.test(this.scan.charAt(i))) i--;
    return i;
  }

  private nextSignificant(pos: number): number {
    let i = pos;
    while (i < this.scan.length && /\s/.test(this.scan.charAt(i))) i++;
    return i;
  }

  /** Erases the `?`/`!` marker found by scanning backwards from `limit` (an annotation start or the node end). */
  private eraseMarkerBefore(limit: number, marker: "?" | "!"): void {
    const at = this.prevSignificant(limit);
    if (at >= 0 && this.scan.charAt(at) === marker) this.erase(at, at + 1);
  }

  /** Erases the `?`/`!` marker that directly follows a class member's key. */
  private eraseMarkerAfterKey(member: AstNode, marker: "?" | "!"): void {
    const key = member.key;
    if (!isNode(key)) return;
    let at = this.nextSignificant(key.end);
    if (member.computed === true && this.scan.charAt(at) === "]") at = this.nextSignificant(at + 1);
    if (this.scan.charAt(at) === marker) this.erase(at, at + 1);
  }

  /** Erases a keyword that must appear in `[from, to)` (a modifier before a class member's key). */
  private eraseKeyword(word: string, from: number, to: number): void {
    const slice = this.scan.slice(from, to);
    const m = new RegExp(`(?<![\\w$])${word}(?![\\w$])`).exec(slice);
    if (m) this.erase(from + m.index, from + m.index + word.length);
  }

  private eraseClassMemberSyntax(member: AstNode): void {
    const key = member.key;
    const keyStart = isNode(key) ? key.start : member.end;
    for (const flag of CLASS_MODIFIERS) {
      const value = member[flag];
      if (value === undefined || value === false || value === null) continue;
      const word = flag === "accessibility" ? String(value) : flag;
      this.eraseKeyword(word, member.start, keyStart);
    }
    if (member.optional === true) this.eraseMarkerAfterKey(member, "?");
    if (member.definite === true) this.eraseMarkerAfterKey(member, "!");
  }

  walk(node: AstNode): void {
    switch (node.type) {
      case "TSEnumDeclaration":
        if (node.declare === true) this.erase(node.start, node.end);
        else
          this.refuse(
            node.start,
            node.end,
            "enum",
            "An enum needs runtime code. Use a plain object (`const Color = { Red: 0, Green: 1 } as const`) or a union of string literals.",
          );
        return;
      case "TSModuleDeclaration":
        if (isTypeOnlyNamespace(node)) this.erase(node.start, node.end);
        else
          this.refuse(
            node.start,
            node.end,
            "namespace declaration",
            "A namespace with values needs runtime code. Use an object literal or top-level functions instead.",
          );
        return;
      case "TSImportEqualsDeclaration":
        this.refuse(
          node.start,
          node.end,
          "import equals declaration",
          "Use `const name = require(...)`, or leave module imports out: the playground runs a single script.",
        );
        return;
      case "TSExportAssignment":
        this.refuse(
          node.start,
          node.end,
          "export assignment",
          "Assign to `module.exports` instead of using `export =`.",
        );
        return;
      case "TSTypeAssertion":
        this.refuse(node.start, node.end, "type assertion", "Write the cast as `expr as T` instead of `<T>expr`.");
        return;
      case "TSParameterProperty":
        this.refuse(
          node.start,
          node.end,
          "parameter property",
          "Declare the field in the class body and assign it in the constructor.",
        );
        return;
      case "TSAsExpression":
      case "TSSatisfiesExpression": {
        const keyword = node.type === "TSAsExpression" ? "as" : "satisfies";
        const annotation = node.typeAnnotation;
        if (isNode(annotation)) {
          const end = this.prevSignificant(annotation.start) + 1;
          this.erase(end - keyword.length, node.end);
        }
        if (isNode(node.expression)) this.walk(node.expression);
        return;
      }
      case "TSNonNullExpression":
        this.erase(node.end - 1, node.end);
        if (isNode(node.expression)) this.walk(node.expression);
        return;
      default:
        break;
    }

    if (ERASE_WHOLE.has(node.type)) {
      this.erase(node.start, node.end);
      return;
    }
    if (node.declare === true) {
      this.erase(node.start, node.end);
      return;
    }

    if (Array.isArray(node.decorators)) {
      for (const d of node.decorators) {
        if (isNode(d)) {
          this.refuse(d.start, d.end, "decorator", "Remove the decorator and call the wrapping function yourself.");
        }
      }
    }

    if (CLASS_MEMBERS.has(node.type)) {
      if (node.abstract === true && node.type !== "ClassMethod") {
        this.erase(node.start, node.end);
        return;
      }
      this.eraseClassMemberSyntax(node);
    } else if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.abstract === true) {
        const id = node.id;
        this.eraseKeyword("abstract", node.start, isNode(id) ? id.start : node.end);
      }
      const implemented = Array.isArray(node.implements) ? node.implements.filter(isNode) : [];
      const first = implemented[0];
      const last = implemented[implemented.length - 1];
      if (first && last) {
        const keywordEnd = this.prevSignificant(first.start) + 1;
        this.erase(keywordEnd - "implements".length, last.end);
      }
    } else if (
      node.optional === true &&
      (node.type === "Identifier" || node.type === "ObjectPattern" || node.type === "ArrayPattern")
    ) {
      const annotation = node.typeAnnotation;
      this.eraseMarkerBefore(isNode(annotation) ? annotation.start : node.end, "?");
    } else if (node.type === "VariableDeclarator" && node.definite === true && isNode(node.id)) {
      const annotation = node.id.typeAnnotation;
      this.eraseMarkerBefore(isNode(annotation) ? annotation.start : node.id.end, "!");
    }

    if (FUNCTION_LIKE.has(node.type) && Array.isArray(node.params)) this.eraseThisParameter(node.params);

    for (const key of Object.keys(node)) {
      if (SKIPPED_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) this.walk(item);
      } else if (isNode(value)) {
        this.walk(value);
      }
    }
  }

  /** `function f(this: T, a)`: the `this` pseudo-parameter and its comma are types, not parameters. */
  private eraseThisParameter(params: unknown[]): void {
    const first = params[0];
    if (!isNode(first) || first.type !== "Identifier" || first.name !== "this") return;
    const next = params[1];
    this.erase(first.start, isNode(next) ? next.start : first.end);
  }
}

function stripSyntaxError(source: string, error: unknown): Diagnostic {
  const e = error as { message?: unknown; pos?: unknown };
  const pos = typeof e.pos === "number" ? Math.min(Math.max(e.pos, 0), source.length) : 0;
  const raw = typeof e.message === "string" ? e.message : "Unexpected syntax";
  return {
    code: "E_SYNTAX",
    message: raw.replace(/\s*\(\d+:\d+\)$/, ""),
    range: { start: pos, end: Math.min(pos + 1, source.length) },
    hint: "Fix the syntax error: the TypeScript parser could not read this file.",
  };
}

/**
 * Erases type syntax, replacing each erased code unit with a space and keeping
 * every line terminator. The result has exactly the input's length, so source
 * offsets into it are offsets into the original. Pass BOM-less text.
 */
export function stripTypes(source: string): Result<string, Diagnostic[]> {
  let ast: ReturnType<typeof parse>;
  try {
    // errorRecovery: recoverable errors (e.g. import/export in a script) are
    // left to the real parse of the stripped text; only unrecoverable ones throw.
    ast = parse(source, {
      sourceType: "script",
      plugins: ["typescript", "decorators"],
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowNewTargetOutsideFunction: true,
    });
  } catch (error) {
    return err([stripSyntaxError(source, error)]);
  }

  const comments = (ast.comments ?? []).filter(
    (c): c is typeof c & { start: number; end: number } => typeof c.start === "number" && typeof c.end === "number",
  );
  const stripper = new Stripper(source, comments);
  stripper.walk(ast.program as unknown as AstNode);
  if (stripper.diagnostics.length > 0) {
    return err([...stripper.diagnostics].sort((a, b) => a.range.start - b.range.start));
  }
  return ok(stripper.result());
}
