import type { MemberExpression, Node } from "estree";
import type { Diagnostic, SourceRange } from "@/core/shared/diagnostics";
import { childNodes, rangeOf } from "../ast";
import type { ParsedProgram } from "../parse";
import type { ReferenceInfo, ScopeTree } from "../scope/Scope";
import {
  ALLOWED_GLOBALS,
  CONSTRUCTOR_GLOBALS,
  excludedEntry,
  FREE_USE_GLOBALS,
  NAMESPACE_MEMBERS,
  NODE_GLOBALS,
  PROTOTYPE_MEMBERS,
  SPECIFIC_EXCLUDED_GLOBALS,
} from "./excluded";

// The subset validator (PROMPT.md §3.3): refuses what the simulator does not model, with a
// diagnostic over the offending token and a hint. Source is only parsed and analysed here.
//
// Excluded globals are resolved through the scope tree, not matched by name: a local
// `Date` is the user's own, `const M = Math` is refused as an alias, and `Math.random`
// is refused however it is spelled with a constant key. What a static pass cannot see
// (`x[k]` with a computed `k` on an ordinary object, instance-method names such as
// `.sort`) is not checked; the simulator models those at run time.

export const MAX_SOURCE_BYTES = 10_240;
export const MAX_LINES = 400;

const DOCS = "docs/SUPPORTED_SUBSET.md";
const NODE_GLOBAL_NAMES: ReadonlySet<string> = new Set(NODE_GLOBALS);

/** Ids whose message names the offending source text (the table message is generic for these). */
const NAMES_SUBJECT = new Set(["member-not-supported", "node-global", "Math.*", "process.*", "require", "alias"]);

function diagnosticFor(id: string, range: SourceRange, source: string): Diagnostic {
  const entry = excludedEntry(id);
  const snippet = source.slice(range.start, range.end);
  const message = NAMES_SUBJECT.has(id) && snippet.length <= 60 ? `\`${snippet}\`: ${entry.message}` : entry.message;
  return { code: entry.code, message, range, hint: entry.hint, docs: DOCS };
}

// ---- limits -----------------------------------------------------------------------------

export function checkSourceLimits(source: string): Diagnostic[] {
  const out: Diagnostic[] = [];

  let bytes = 0;
  for (let i = 0; i < source.length; i++) {
    const cp = source.codePointAt(i) ?? 0;
    const units = cp > 0xffff ? 2 : 1;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes > MAX_SOURCE_BYTES) {
      out.push(diagnosticFor("limit-source-size", { start: i, end: i + units }, source));
      break;
    }
    i += units - 1;
  }

  // A line ends at "\n", "\r\n" or a lone "\r"; text after the last terminator is one more line.
  let terminators = 0;
  let lineStart = 0;
  let overflowStart = -1;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c !== 10 && c !== 13) continue;
    if (c === 13 && source.charCodeAt(i + 1) === 10) i++;
    terminators++;
    lineStart = i + 1;
    if (terminators === MAX_LINES) overflowStart = lineStart;
  }
  const lines = terminators + (lineStart < source.length ? 1 : 0);
  if (lines > MAX_LINES) {
    let end = overflowStart;
    while (end < source.length && source.charCodeAt(end) !== 10 && source.charCodeAt(end) !== 13) end++;
    out.push(
      diagnosticFor("limit-lines", { start: overflowStart, end: Math.max(end, Math.min(overflowStart + 1, source.length)) }, source),
    );
  }
  return out;
}

// ---- helpers ------------------------------------------------------------------------------

/** Offset of the first `token` in `[from, to)` outside comments, or -1. */
function findToken(source: string, from: number, to: number, token: string): number {
  for (let i = from; i < to; ) {
    if (source.startsWith("//", i)) {
      while (i < to && source.charCodeAt(i) !== 10 && source.charCodeAt(i) !== 13) i++;
    } else if (source.startsWith("/*", i)) {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? to : close + 2;
    } else if (source.startsWith(token, i)) {
      return i;
    } else {
      i++;
    }
  }
  return -1;
}

/** The property name of `a.b`, `a['b']` or ``a[`b`]``; undefined for any other computed key. */
function constantKey(node: MemberExpression): string | undefined {
  const property = node.property;
  if (!node.computed) return property.type === "Identifier" ? property.name : undefined;
  if (property.type === "Literal") return typeof property.value === "string" ? property.value : undefined;
  if (property.type === "TemplateLiteral" && property.expressions.length === 0) {
    return property.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

const has = (table: object, key: string): boolean => Object.hasOwn(table, key);

function isWrapperParameter(ref: ReferenceInfo): boolean {
  const v = ref.resolved;
  return v !== "global" && v.kind === "param" && v.scope.parent === null && v.declaredAt.start === 0 && v.declaredAt.end === 0;
}

// ---- the walk -----------------------------------------------------------------------------------

class Validator {
  private readonly out: Diagnostic[] = [];
  /** Member expressions whose object global was already judged with the whole member. */
  private readonly judged = new Set<Node>();

  constructor(
    private readonly source: string,
    private readonly scopes: ScopeTree,
  ) {}

  run(root: Node): Diagnostic[] {
    this.visit(root, null);
    return this.out;
  }

  private report(id: string, range: SourceRange): void {
    this.out.push(diagnosticFor(id, range, this.source));
  }

  private reportKeyword(id: string, node: Node, length: number): void {
    const { start } = rangeOf(node);
    this.report(id, { start, end: start + length });
  }

  private reportOperator(id: string, left: Node, right: Node, operator: string): void {
    const from = rangeOf(left).end;
    const to = rangeOf(right).start;
    const at = findToken(this.source, from, to, operator);
    this.report(id, at === -1 ? { start: from, end: to } : { start: at, end: at + operator.length });
  }

  private visitChildren(node: Node): void {
    for (const child of childNodes(node)) this.visit(child, node);
  }

  private visit(node: Node, parent: Node | null): void {
    switch (node.type) {
      case "ClassDeclaration":
      case "ClassExpression":
        this.reportKeyword("class", node, "class".length);
        return;
      case "SwitchStatement":
        this.reportKeyword("switch", node, "switch".length);
        break;
      case "DoWhileStatement":
        this.reportKeyword("do-while", node, "do".length);
        break;
      case "ForInStatement":
        this.reportKeyword("for-in", node, "for".length);
        break;
      case "ForOfStatement":
        this.reportKeyword("for-of", node, "for".length);
        break;
      case "LabeledStatement":
        this.report("labeled-statement", rangeOf(node.label));
        break;
      case "WithStatement":
        this.reportKeyword("with-statement", node, "with".length);
        break;
      case "DebuggerStatement":
        this.reportKeyword("debugger", node, "debugger".length);
        break;
      case "TaggedTemplateExpression":
        this.report("tagged-template", rangeOf(node));
        break;
      case "ObjectPattern":
      case "ArrayPattern":
        this.report("destructuring", rangeOf(node));
        return;
      case "SpreadElement":
      case "RestElement":
        this.report("spread-rest", rangeOf(node));
        break;
      case "ImportExpression":
        this.report("dynamic-import", rangeOf(node));
        return;
      case "MetaProperty":
        this.report(node.meta.name === "new" ? "new-target" : "dynamic-import", rangeOf(node));
        return;
      case "Literal":
        if ("regex" in node) this.report("regex-literal", rangeOf(node));
        else if ("bigint" in node) this.report("bigint-literal", rangeOf(node));
        return;
      case "BinaryExpression":
        if (node.operator === "instanceof") this.reportOperator("instanceof", node.left, node.right, "instanceof");
        else if (node.operator === "in") this.reportOperator("in-operator", node.left, node.right, "in");
        break;
      case "UnaryExpression":
        if (node.operator === "void") this.reportKeyword("void-operator", node, "void".length);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.generator && !(parent?.type === "Property" && parent.value === node)) {
          this.reportGenerator(rangeOf(node).start, rangeOf(node).end);
        }
        break;
      case "Property":
        this.property(node);
        break;
      case "MemberExpression":
        this.member(node);
        return;
      case "Identifier":
        this.identifier(node, parent);
        return;
      default:
        break;
    }
    this.visitChildren(node);
  }

  private reportGenerator(from: number, to: number): void {
    const at = findToken(this.source, from, to, "*");
    this.report("generator", at === -1 ? { start: from, end: Math.min(from + 1, to) } : { start: at, end: at + 1 });
  }

  private property(node: Extract<Node, { type: "Property" }>): void {
    if (node.kind === "get" || node.kind === "set") this.report("getter-setter", rangeOf(node.key));
    if (node.computed) this.report("computed-property-key", rangeOf(node.key));
    if (node.value.type === "FunctionExpression" && node.value.generator) {
      this.reportGenerator(rangeOf(node).start, rangeOf(node.value).start);
    }
    const key = node.key;
    const protoKey =
      !node.computed &&
      !node.shorthand &&
      !node.method &&
      node.kind === "init" &&
      ((key.type === "Identifier" && key.name === "__proto__") || (key.type === "Literal" && key.value === "__proto__"));
    if (protoKey) this.report("prototype-access", rangeOf(key));
  }

  private member(node: MemberExpression): void {
    const key = constantKey(node);
    const object = node.object;
    if (key !== undefined && PROTOTYPE_MEMBERS.has(key)) {
      this.report("prototype-access", rangeOf(node.property));
      this.judged.add(node);
    } else if (object.type === "ThisExpression" && key !== undefined && has(SPECIFIC_EXCLUDED_GLOBALS, key)) {
      this.report(SPECIFIC_EXCLUDED_GLOBALS[key] as string, rangeOf(node));
      this.judged.add(node);
    } else if (object.type === "Identifier") {
      this.globalMember(node, object, key);
    }
    this.visit(object, node);
    if (node.computed) this.visit(node.property, node);
  }

  /** `Math.floor`, `Array.isArray`, `module.exports`, …: judged as a whole, with the member in hand. */
  private globalMember(node: MemberExpression, object: Extract<Node, { type: "Identifier" }>, key: string | undefined): void {
    const ref = this.scopes.referenceOf.get(object);
    if (!ref) return;
    const name = ref.name;
    if (ref.resolved === "global") {
      if (has(NAMESPACE_MEMBERS, name)) {
        this.judged.add(node);
        const allowed = NAMESPACE_MEMBERS[name] as ReadonlySet<string>;
        if (key !== undefined && allowed.has(key)) return;
        const id = key === undefined ? "alias" : name === "Math" ? "Math.*" : name === "process" ? "process.*" : "member-not-supported";
        this.report(id, rangeOf(node));
      } else if (CONSTRUCTOR_GLOBALS.has(name)) {
        this.judged.add(node);
        this.report("member-not-supported", rangeOf(node));
      }
    } else if (isWrapperParameter(ref)) {
      if (name === "exports") {
        this.judged.add(node);
      } else if (name === "module") {
        this.judged.add(node);
        if (key !== "exports") this.report("require", rangeOf(node));
      }
    }
  }

  private identifier(node: Extract<Node, { type: "Identifier" }>, parent: Node | null): void {
    const ref = this.scopes.referenceOf.get(node);
    if (!ref) return;
    if (parent?.type === "MemberExpression" && parent.object === node && this.judged.has(parent)) return;
    if (ref.resolved === "global") this.globalReference(ref, parent);
    else if (isWrapperParameter(ref)) this.wrapperReference(ref);
  }

  private globalReference(ref: ReferenceInfo, parent: Node | null): void {
    const name = ref.name;
    if (name === "arguments") return this.report("arguments-object", ref.range);
    if (has(SPECIFIC_EXCLUDED_GLOBALS, name)) return this.report(SPECIFIC_EXCLUDED_GLOBALS[name] as string, ref.range);
    if (FREE_USE_GLOBALS.has(name)) return;
    if (ALLOWED_GLOBALS.has(name)) {
      if (ref.inTypeof || CONSTRUCTOR_GLOBALS.has(name)) return;
      if (name === "Promise" && parent?.type === "NewExpression" && parent.callee === ref.node) return;
      return this.report("alias", ref.range);
    }
    if (NODE_GLOBAL_NAMES.has(name)) this.report("node-global", ref.range);
    // Any other name is not a global in Node: using it is a real ReferenceError, modelled exactly.
  }

  private wrapperReference(ref: ReferenceInfo): void {
    if (ref.name === "exports" || ref.inTypeof) return;
    this.report("require", ref.range);
  }
}

export function validateSubset(program: ParsedProgram, scopes: ScopeTree): Diagnostic[] {
  const found = [...checkSourceLimits(program.source), ...new Validator(program.source, scopes).run(program.ast)];
  return found.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
}
