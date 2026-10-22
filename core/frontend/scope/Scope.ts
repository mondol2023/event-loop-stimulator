import type { Identifier, Node } from "estree";
import type { SourceRange } from "@/core/shared/diagnostics";

// Result types of scope analysis. The model follows V8's `Scope`/`Variable`
// (src/ast/scopes.h, variables.h): hoisting, the temporal dead zone, and
// allocation of each variable to a stack register, a context slot, a parameter
// or the callee closure. Treat everything here as read-only once
// `analyzeScopes` has returned.

export type ScopeKind = "function" | "block" | "catch";

/**
 * `temporary` is one of V8's `.for` variables (Scope::NewTemporary) that a desugared
 * `for (let …)` loop keeps in its function's registers.
 *
 * `arguments` is the implicit binding that holds a function's arguments object.
 *
 * `function-name` is the self-binding of a named function expression
 * (`const f = function g() { g }`); V8 keeps it outside the function's own
 * scope, which this model collapses into the function scope (shadowable by a
 * parameter or var of the same name).
 */
export type VariableKind = "var" | "let" | "const" | "function" | "param" | "catch" | "function-name" | "this" | "temporary" | "arguments";

/**
 * Where a variable lives at run time:
 * - `register`: a stack slot of its function, numbered function-wide in V8's
 *   allocation order (a scope's own locals, then inner scopes in tree order);
 * - `context`: a slot (0-based, before V8's fixed header slots) of the context
 *   of the scope that declares it, iff an inner function references it;
 * - `parameter`: argument `index` (0-based, receiver excluded).
 */
export type Allocation =
  | { readonly kind: "register"; readonly index: number }
  | { readonly kind: "context"; readonly index: number }
  | { readonly kind: "parameter"; readonly index: number }
  /** No code names the variable (no reference, no initializer): V8 gives it no storage at all. */
  | { readonly kind: "unused" };

export type Variable = {
  readonly name: string;
  kind: VariableKind;
  /** The declaring identifier (for the CommonJS wrapper's own parameters, the empty range at 0). */
  readonly declaredAt: SourceRange;
  readonly scope: Scope;
  allocation: Allocation;
  /** True when a function other than the declaring one references it (V8 context allocation). */
  captured: boolean;
  /** True when a reference writes it after the declaration (V8 `maybe_assigned`); a never-assigned context slot loads as immutable. */
  maybeAssigned: boolean;
  /** True when some reference needs a hole check, so the binding starts out as the hole (V8 `binding_needs_init`). */
  needsHoleInit: boolean;
  /** True when a reference resolves to it or its declaration initializes it; only such variables get storage. */
  used: boolean;
  /** Position of the argument for a `param`, kept even when the variable moves to the context. */
  parameterIndex?: number;
  /** A `var` that exists only because of Annex B.3.3 block-function hoisting (sloppy code). */
  annexB: boolean;
  /** `let`/`const`/non-simple parameters: reading before initialization throws a ReferenceError. */
  readonly tdz: boolean;
  /** Source offset from which a use in the declaring closure is known to be initialized. */
  initializedAt: number;
};

export type Access = "read" | "write" | "readwrite";

export type ReferenceInfo = {
  readonly name: string;
  readonly node: Identifier;
  readonly range: SourceRange;
  /** The scope the reference appears in. */
  readonly scope: Scope;
  /** The variable it binds to, or `"global"` for a name no scope declares. */
  readonly resolved: Variable | "global";
  /** Whether bytecode must guard the access with a hole check (`ThrowReferenceErrorIfHole`). */
  readonly needsTdzCheck: boolean;
  readonly access: Access;
  /** The operand of `typeof` (`LdaGlobalInsideTypeof` for an unresolved name). */
  readonly inTypeof: boolean;
};

export type Scope = {
  readonly kind: ScopeKind;
  /** The AST node that creates the scope (Program for the wrapper, a function, block, `for`, `switch` or catch clause). */
  readonly node: Node;
  readonly parent: Scope | null;
  readonly children: Scope[];
  /** In declaration order; for a function: parameters first. */
  readonly variables: Variable[];
  readonly strict: boolean;
  /** True when some variable of this scope is context-allocated. */
  needsContext: boolean;
  /** Number of context slots the scope's variables occupy. */
  contextSlots: number;
  /** Function scopes only: registers taken by locals of the function (all its non-function scopes). */
  stackSlots: number;
  /**
   * A `for (let/const …)` scope that V8 desugars (Parser::DesugarLexicalBindingsInForStatement)
   * because a function literal appears somewhere in the loop: each iteration gets fresh copies.
   */
  perIteration: boolean;
  /** For a `perIteration` loop scope: the copies' scope and the temporaries the desugaring adds. */
  iteration: ForIteration | null;
  /** Function scopes only: the declared parameter names in order (duplicates kept; non-identifier patterns as ""). */
  readonly parameterNames: readonly string[];
  /** Function scopes only: no defaults, rest or destructuring in the parameter list. */
  readonly hasSimpleParameters: boolean;
  /** Function scopes only: an `async` function or arrow. V8 compiles it as a generator, whose object takes the first register. */
  isAsync: boolean;
  /** Function scopes only: the `await`s in the function's own body (not in functions nested in it), each a point where it can suspend. */
  suspendCount: number;
  /** Non-arrow function scopes only: the receiver as a variable, present iff an arrow inside reads `this` (it then lives in the context). */
  thisVariable: Variable | null;
  /**
   * A function body's own declaration scope when the parameter list is not simple (V8's varblock):
   * the body's `var`s and functions live here, apart from the parameters and their expressions.
   */
  varBlock: boolean;
  /** Var blocks only: body `var`s named like a parameter, in declaration order; each starts out as that parameter's value. */
  parameterShadows: { readonly parameter: Variable; readonly variable: Variable }[];
  /** Function scopes only: the variable the arguments object is stored in, when the function creates one (V8's `arguments_`). */
  argumentsVariable: Variable | null;
  /** Async function scopes only: the register of the generator object (V8's `.generator_object`), else -1. */
  generatorRegister: number;
};

/**
 * The pieces of V8's for-let desugaring. The loop scope keeps the bindings the initializer
 * declares; `scope` (its only child) declares a copy of each, which the test, update and body
 * see, and which a closure captures. Values cross between iterations through `temporaries`.
 */
export type ForIteration = {
  readonly scope: Scope;
  /** The copies, in the order the initializer declares the originals. */
  readonly copies: readonly Variable[];
  /** `temp_x` for each copy, function registers. */
  readonly temporaries: readonly Variable[];
  /** Set before the first iteration so that it skips the update; absent when the loop has none. */
  readonly first: Variable | null;
  /** Set while an iteration runs: still set after the inner loop means the body broke out. */
  readonly flag: Variable;
};

export type ScopeTree = {
  /** The CommonJS wrapper function: `(exports, require, module, __filename, __dirname)`. */
  readonly root: Scope;
  /** Every scope, parents before children, siblings in source order. */
  readonly scopes: readonly Scope[];
  /** Every identifier reference, in source order. Declarations are not references. */
  readonly references: readonly ReferenceInfo[];
  /** Identifier node → its reference. */
  readonly referenceOf: ReadonlyMap<Node, ReferenceInfo>;
  /** Declaring identifier node → its variable. */
  readonly declarationOf: ReadonlyMap<Node, Variable>;
  /** Scope-creating node → its scope. */
  readonly scopeOf: ReadonlyMap<Node, Scope>;
  /** `this` expression → the context variable holding the receiver; absent when it is read from the frame. */
  readonly thisOf: ReadonlyMap<Node, Variable>;
  /** The identifier of a sloppy block function declaration → the function-level `var` it is also assigned to (Annex B.3.3). */
  readonly hoistedFunctionOf: ReadonlyMap<Node, Variable>;
};
