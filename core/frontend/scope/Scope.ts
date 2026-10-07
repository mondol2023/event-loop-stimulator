import type { Identifier, Node } from "estree";
import type { SourceRange } from "@/core/shared/diagnostics";

// Result types of scope analysis. The model follows V8's `Scope`/`Variable`
// (src/ast/scopes.h, variables.h): hoisting, the temporal dead zone, and
// allocation of each variable to a stack register, a context slot, a parameter
// or the callee closure. Treat everything here as read-only once
// `analyzeScopes` has returned.

export type ScopeKind = "function" | "block" | "catch";

/**
 * `function-name` is the self-binding of a named function expression
 * (`const f = function g() { g }`); V8 keeps it outside the function's own
 * scope, which this model collapses into the function scope (shadowable by a
 * parameter or var of the same name).
 */
export type VariableKind = "var" | "let" | "const" | "function" | "param" | "catch" | "function-name";

/**
 * Where a variable lives at run time:
 * - `register`: a stack slot of its function, numbered function-wide in V8's
 *   allocation order (a scope's own locals, then inner scopes in tree order);
 * - `context`: a slot (0-based, before V8's fixed header slots) of the context
 *   of the scope that declares it, iff an inner function references it;
 * - `parameter`: argument `index` (0-based, receiver excluded);
 * - `closure`: the callee itself, for an uncaptured `function-name`.
 */
export type Allocation =
  | { readonly kind: "register"; readonly index: number }
  | { readonly kind: "context"; readonly index: number }
  | { readonly kind: "parameter"; readonly index: number }
  | { readonly kind: "closure" };

export type Variable = {
  readonly name: string;
  kind: VariableKind;
  /** The declaring identifier (for the CommonJS wrapper's own parameters, the empty range at 0). */
  readonly declaredAt: SourceRange;
  readonly scope: Scope;
  allocation: Allocation;
  /** True when a function other than the declaring one references it (V8 context allocation). */
  captured: boolean;
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
  /** A `for (let …)` scope whose bindings a closure captures: each iteration gets a fresh copy. */
  perIteration: boolean;
  /** Function scopes only: the declared parameter names in order (duplicates kept; non-identifier patterns as ""). */
  readonly parameterNames: readonly string[];
  /** Function scopes only: no defaults, rest or destructuring in the parameter list. */
  readonly hasSimpleParameters: boolean;
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
};
