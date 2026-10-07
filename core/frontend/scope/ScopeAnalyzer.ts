import type { Class, Function as EsFunction, Identifier, Node, Statement } from "estree";
import type { SourceRange } from "@/core/shared/diagnostics";
import { childNodes, hasUseStrictDirective, rangeOf } from "../ast";
import type { ParsedProgram } from "../parse";
import type {
  Access,
  Allocation,
  ReferenceInfo,
  Scope,
  ScopeKind,
  ScopeTree,
  Variable,
  VariableKind,
} from "./Scope";

// Scope analysis in two passes over the ESTree, modelled on V8's parser
// (Scope::DeclareVariable, Scope::ResolveVariable, AllocateVariablesRecursively):
// 1. declare: build the scope tree and declare every binding in textual order
//    (V8 allocates in declaration order), collect identifier references;
// 2. resolve: bind each reference through the scope chain, mark variables a
//    closure captures, decide hole checks, then allocate registers/context slots.
// The user's program is only read here, never run.

const WRAPPER_PARAMETERS = ["exports", "require", "module", "__filename", "__dirname"] as const;

const UNALLOCATED: Allocation = { kind: "register", index: -1 };
const NO_RANGE: SourceRange = { start: 0, end: 0 };

type PendingReference = {
  readonly node: Identifier;
  readonly scope: Scope;
  readonly access: Access;
  readonly inTypeof: boolean;
};

type DeclareOptions = {
  readonly scope: Scope;
  readonly kind: VariableKind;
  readonly tdz: boolean;
  readonly initializedAt: number;
  readonly parameterIndex?: number;
};

type SloppyBlockFunction = { readonly name: string; readonly scope: Scope; readonly id: Identifier };

function isLexicalDeclaration(statement: Statement | Node): boolean {
  return (
    (statement.type === "VariableDeclaration" && statement.kind !== "var") ||
    statement.type === "FunctionDeclaration" ||
    statement.type === "ClassDeclaration"
  );
}

function closureOf(scope: Scope): Scope {
  let s = scope;
  while (s.kind !== "function" && s.parent) s = s.parent;
  return s;
}

class Analyzer {
  private readonly scopes: Scope[] = [];
  private readonly pending: PendingReference[] = [];
  private readonly declarations = new Map<Node, Variable>();
  private readonly scopeNodes = new Map<Node, Scope>();
  private readonly byName = new Map<Scope, Map<string, Variable>>();
  private readonly sloppyBlockFunctions: SloppyBlockFunction[] = [];
  private current!: Scope;

  analyze(parsed: ParsedProgram): ScopeTree {
    const root = this.newScope("function", parsed.ast, null, parsed.strict, [...WRAPPER_PARAMETERS], true);
    this.current = root;
    WRAPPER_PARAMETERS.forEach((name, index) => {
      this.declare(name, null, NO_RANGE, {
        scope: root,
        kind: "param",
        tdz: false,
        initializedAt: 0,
        parameterIndex: index,
      });
    });
    for (const statement of parsed.ast.body) this.visit(statement);

    this.hoistSloppyBlockFunctions();
    const references = this.resolve();
    this.allocateFunction(root);

    return {
      root,
      scopes: this.scopes,
      references,
      referenceOf: new Map(references.map((r) => [r.node, r])),
      declarationOf: this.declarations,
      scopeOf: this.scopeNodes,
    };
  }

  // ---- scopes and declarations ------------------------------------------------

  private newScope(
    kind: ScopeKind,
    node: Node,
    parent: Scope | null,
    strict: boolean,
    parameterNames: readonly string[] = [],
    hasSimpleParameters = true,
  ): Scope {
    const scope: Scope = {
      kind,
      node,
      parent,
      children: [],
      variables: [],
      strict,
      needsContext: false,
      contextSlots: 0,
      stackSlots: 0,
      perIteration: false,
      parameterNames,
      hasSimpleParameters,
    };
    parent?.children.push(scope);
    this.scopes.push(scope);
    this.scopeNodes.set(node, scope);
    this.byName.set(scope, new Map());
    return scope;
  }

  private names(scope: Scope): Map<string, Variable> {
    const names = this.byName.get(scope);
    if (!names) throw new Error("scope was not created by this analyzer");
    return names;
  }

  private withScope(create: boolean, kind: ScopeKind, node: Node, body: () => void): void {
    if (!create) {
      body();
      return;
    }
    const outer = this.current;
    this.current = this.newScope(kind, node, outer, outer.strict);
    body();
    this.current = outer;
  }

  private functionScope(): Scope {
    return closureOf(this.current);
  }

  /** Declares `name`, or returns the existing binding of a legal redeclaration (`var`, function, duplicate parameter). */
  private declare(name: string, id: Identifier | null, at: SourceRange, options: DeclareOptions): Variable {
    const names = this.names(options.scope);
    const existing = names.get(name);
    if (existing && existing.kind !== "function-name") {
      if (options.kind === "function" && existing.kind === "var") existing.kind = "function";
      if (options.kind === "param" && existing.kind === "param" && options.parameterIndex !== undefined) {
        existing.parameterIndex = options.parameterIndex;
      }
      if (id) this.declarations.set(id, existing);
      return existing;
    }
    if (existing) {
      // A parameter, var or lexical binding shadows a named function expression's own name.
      options.scope.variables.splice(options.scope.variables.indexOf(existing), 1);
    }
    const variable: Variable = {
      name,
      kind: options.kind,
      declaredAt: at,
      scope: options.scope,
      allocation: UNALLOCATED,
      captured: false,
      annexB: false,
      tdz: options.tdz,
      initializedAt: options.initializedAt,
      ...(options.parameterIndex === undefined ? {} : { parameterIndex: options.parameterIndex }),
    };
    options.scope.variables.push(variable);
    names.set(name, variable);
    if (id) this.declarations.set(id, variable);
    return variable;
  }

  /** Declares every identifier a binding pattern introduces; defaults and computed keys are visited as expressions. */
  private declarePattern(pattern: Node, options: Omit<DeclareOptions, "initializedAt"> & { initializedAt: number }): void {
    switch (pattern.type) {
      case "Identifier":
        this.declare(pattern.name, pattern, rangeOf(pattern), options);
        return;
      case "ObjectPattern":
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            this.declarePattern(property.argument, options);
          } else {
            if (property.computed) this.visit(property.key);
            this.declarePattern(property.value, options);
          }
        }
        return;
      case "ArrayPattern":
        for (const element of pattern.elements) if (element) this.declarePattern(element, options);
        return;
      case "AssignmentPattern":
        this.declarePattern(pattern.left, options);
        this.visit(pattern.right);
        return;
      case "RestElement":
        this.declarePattern(pattern.argument, options);
        return;
      default:
        this.visit(pattern);
    }
  }

  // ---- traversal --------------------------------------------------------------

  private addReference(node: Identifier, access: Access, inTypeof = false): void {
    this.pending.push({ node, scope: this.current, access, inTypeof });
  }

  /** An assignment target: identifiers are writes, member expressions are read normally. */
  private visitTarget(target: Node, access: Access): void {
    switch (target.type) {
      case "Identifier":
        this.addReference(target, access);
        return;
      case "ObjectPattern":
        for (const property of target.properties) {
          if (property.type === "RestElement") {
            this.visitTarget(property.argument, "write");
          } else {
            if (property.computed) this.visit(property.key);
            this.visitTarget(property.value, "write");
          }
        }
        return;
      case "ArrayPattern":
        for (const element of target.elements) if (element) this.visitTarget(element, "write");
        return;
      case "AssignmentPattern":
        this.visitTarget(target.left, "write");
        this.visit(target.right);
        return;
      case "RestElement":
        this.visitTarget(target.argument, "write");
        return;
      default:
        this.visit(target);
    }
  }

  private visitFunction(node: EsFunction): void {
    const outer = this.current;
    const body = node.body;
    const strict = outer.strict || (body.type === "BlockStatement" && hasUseStrictDirective(body.body));
    const simple = node.params.every((p) => p.type === "Identifier");
    const names = node.params.map((p) => (p.type === "Identifier" ? p.name : ""));
    const scope = this.newScope("function", node, outer, strict, names, simple);
    this.current = scope;

    if (node.type === "FunctionExpression" && node.id) {
      this.declare(node.id.name, node.id, rangeOf(node.id), { scope, kind: "function-name", tdz: false, initializedAt: 0 });
    }
    node.params.forEach((param, index) => {
      this.declarePattern(param, {
        scope,
        kind: "param",
        tdz: !simple,
        initializedAt: simple ? 0 : rangeOf(param).end,
        parameterIndex: index,
      });
    });

    if (body.type === "BlockStatement") for (const statement of body.body) this.visit(statement);
    else this.visit(body);
    this.current = outer;
  }

  private visitClass(node: Class): void {
    if (node.superClass) this.visit(node.superClass);
    for (const element of node.body.body) {
      if (element.type === "MethodDefinition") {
        if (element.computed) this.visit(element.key);
        this.visit(element.value);
      } else if (element.type === "PropertyDefinition") {
        if (element.computed) this.visit(element.key);
        if (element.value) this.visit(element.value);
      } else {
        this.visit(element);
      }
    }
  }

  private visit(node: Node): void {
    switch (node.type) {
      case "Identifier":
        this.addReference(node, "read");
        return;

      case "VariableDeclaration": {
        const hoisted = node.kind === "var";
        const lexical = !hoisted;
        const scope = hoisted ? this.functionScope() : this.current;
        for (const declarator of node.declarations) {
          this.declarePattern(declarator.id, {
            scope,
            kind: node.kind === "let" || node.kind === "const" ? node.kind : "var",
            tdz: lexical,
            initializedAt: rangeOf(declarator).end,
          });
          if (declarator.init) this.visit(declarator.init);
        }
        return;
      }

      case "FunctionDeclaration": {
        if (node.id) {
          this.declare(node.id.name, node.id, rangeOf(node.id), {
            scope: this.current,
            kind: "function",
            tdz: false,
            initializedAt: 0,
          });
          if (this.current.kind === "block" && !this.current.strict) {
            this.sloppyBlockFunctions.push({ name: node.id.name, scope: this.current, id: node.id });
          }
        }
        this.visitFunction(node);
        return;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        this.visitFunction(node);
        return;

      case "ClassDeclaration":
        if (node.id) {
          this.declare(node.id.name, node.id, rangeOf(node.id), {
            scope: this.current,
            kind: "let",
            tdz: true,
            initializedAt: rangeOf(node).end,
          });
        }
        this.visitClass(node);
        return;
      case "ClassExpression":
        this.visitClass(node);
        return;

      case "BlockStatement":
        this.withScope(node.body.some(isLexicalDeclaration), "block", node, () => {
          for (const statement of node.body) this.visit(statement);
        });
        return;

      case "ForStatement":
        this.withScope(
          node.init?.type === "VariableDeclaration" && node.init.kind !== "var",
          "block",
          node,
          () => {
            if (node.init) this.visit(node.init);
            if (node.test) this.visit(node.test);
            if (node.update) this.visit(node.update);
            this.visit(node.body);
          },
        );
        return;

      case "ForInStatement":
      case "ForOfStatement":
        this.withScope(node.left.type === "VariableDeclaration" && node.left.kind !== "var", "block", node, () => {
          if (node.left.type === "VariableDeclaration") this.visit(node.left);
          else this.visitTarget(node.left, "write");
          this.visit(node.right);
          this.visit(node.body);
        });
        return;

      case "SwitchStatement":
        this.visit(node.discriminant);
        this.withScope(
          node.cases.some((c) => c.consequent.some(isLexicalDeclaration)),
          "block",
          node,
          () => {
            for (const c of node.cases) {
              if (c.test) this.visit(c.test);
              for (const statement of c.consequent) this.visit(statement);
            }
          },
        );
        return;

      case "CatchClause":
        this.withScope(node.param !== null && node.param !== undefined, "catch", node, () => {
          if (node.param) {
            this.declarePattern(node.param, { scope: this.current, kind: "catch", tdz: false, initializedAt: 0 });
          }
          this.visit(node.body);
        });
        return;

      case "LabeledStatement":
        this.visit(node.body);
        return;
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
      case "ThisExpression":
      case "Super":
        return;

      case "MemberExpression":
        this.visit(node.object);
        if (node.computed) this.visit(node.property);
        return;

      case "Property":
        if (node.computed) this.visit(node.key);
        this.visit(node.value);
        return;

      case "AssignmentExpression":
        this.visitTarget(node.left, node.operator === "=" ? "write" : "readwrite");
        this.visit(node.right);
        return;

      case "UpdateExpression":
        this.visitTarget(node.argument, "readwrite");
        return;

      case "UnaryExpression":
        if (node.operator === "typeof" && node.argument.type === "Identifier") {
          this.addReference(node.argument, "read", true);
        } else {
          this.visit(node.argument);
        }
        return;

      default:
        for (const child of childNodes(node)) this.visit(child);
    }
  }

  // ---- Annex B.3.3 --------------------------------------------------------------

  /**
   * Sloppy-mode block functions also create a function-level `var` (V8:
   * DeclarationScope::HoistSloppyBlockFunctions, run at the end of the function),
   * unless that would collide with a lexical binding between the block and the function.
   */
  private hoistSloppyBlockFunctions(): void {
    for (const entry of this.sloppyBlockFunctions) {
      let scope = entry.scope.parent;
      let conflict = false;
      while (scope && scope.kind !== "function") {
        const existing = this.names(scope).get(entry.name);
        if (existing && (existing.kind === "let" || existing.kind === "const" || existing.kind === "function")) {
          conflict = true;
        }
        scope = scope.parent;
      }
      if (conflict || !scope) continue;

      const existing = this.names(scope).get(entry.name);
      if (existing && existing.kind !== "function-name") {
        // An existing var/function is reused; a parameter or let/const blocks hoisting.
        continue;
      }
      const hoisted = this.declare(entry.name, null, rangeOf(entry.id), {
        scope,
        kind: "var",
        tdz: false,
        initializedAt: 0,
      });
      hoisted.annexB = true;
    }
  }

  // ---- resolution -----------------------------------------------------------------

  private resolve(): ReferenceInfo[] {
    const references: ReferenceInfo[] = [];
    for (const ref of this.pending) {
      let resolved: Variable | undefined;
      for (let scope: Scope | null = ref.scope; scope && !resolved; scope = scope.parent) {
        resolved = this.names(scope).get(ref.node.name);
      }
      const range = rangeOf(ref.node);
      let needsTdzCheck = false;
      if (resolved) {
        const crossesClosure = closureOf(ref.scope) !== closureOf(resolved.scope);
        if (crossesClosure) resolved.captured = true;
        needsTdzCheck = resolved.tdz && (crossesClosure || range.start < resolved.initializedAt);
      }
      references.push({
        name: ref.node.name,
        node: ref.node,
        range,
        scope: ref.scope,
        resolved: resolved ?? "global",
        needsTdzCheck,
        access: ref.access,
        inTypeof: ref.inTypeof,
      });
    }
    return references.sort((a, b) => a.range.start - b.range.start);
  }

  // ---- allocation -------------------------------------------------------------------

  private allocateFunction(fn: Scope): void {
    const registers = { next: 0 };
    this.allocateScope(fn, registers);
    fn.stackSlots = registers.next;
  }

  private allocateScope(scope: Scope, registers: { next: number }): void {
    for (const variable of scope.variables) {
      if (variable.captured) {
        variable.allocation = { kind: "context", index: scope.contextSlots++ };
      } else if (variable.kind === "function-name") {
        variable.allocation = { kind: "closure" };
      } else if (variable.kind === "param" && variable.parameterIndex !== undefined) {
        variable.allocation = { kind: "parameter", index: variable.parameterIndex };
      } else {
        variable.allocation = { kind: "register", index: registers.next++ };
      }
    }
    scope.needsContext = scope.contextSlots > 0;
    const loop = scope.node.type;
    if (loop === "ForStatement" || loop === "ForInStatement" || loop === "ForOfStatement") {
      scope.perIteration = scope.variables.some((v) => v.captured);
    }
    for (const child of scope.children) {
      if (child.kind === "function") this.allocateFunction(child);
      else this.allocateScope(child, registers);
    }
  }
}

export function analyzeScopes(program: ParsedProgram): ScopeTree {
  return new Analyzer().analyze(program);
}
