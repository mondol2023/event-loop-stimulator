import type {
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  AwaitExpression,
  BinaryExpression,
  BlockStatement,
  CatchClause,
  ChainExpression,
  ConditionalExpression,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  LogicalExpression,
  MemberExpression,
  NewExpression,
  Node,
  ObjectExpression,
  Pattern,
  Property,
  ReturnStatement,
  SimpleCallExpression,
  Statement,
  TemplateLiteral,
  ThrowStatement,
  TryStatement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  WhileStatement,
} from "estree";
import type { ReferenceInfo, Scope, ScopeTree, Variable } from "@/core/frontend/scope/Scope";
import type { FunctionId } from "@/core/shared/ids";
import { BytecodeArrayBuilder, type JumpTable, type Label } from "./BytecodeArrayBuilder";
import { BytecodeLabels } from "./BytecodeLabels";
import { CLOSURE, CURRENT_CONTEXT, type Opcode, THIS, argument, local } from "./bytecodes";
import { type Command, DeferredCommands } from "./DeferredCommands";
import type { FeedbackSlotKind } from "./FeedbackVectorSpec";
import { type LiteralValue, isSmi, literalOf, toBooleanOf } from "./literals";
import { arrayBoilerplateText, arrayFlags, elementIndexOf, isCompileTimeValue, objectBoilerplateText, objectFlags } from "./literalShape";
import { endOf, endWithParentheses, operatorPosition, startOf } from "./sourceText";

// V8's BytecodeGenerator for one function body (src/interpreter/bytecode-generator.cc). The shape
// follows V8 closely because the output is compared with `--print-bytecode` instruction by
// instruction: the order registers are taken, the slot a feedback vector gives each operation and
// where a source position lands all change the listing.

/** A construct the generator does not compile yet. Caught at the top and reported as a diagnostic. */
export class NotYetSupported extends Error {
  constructor(readonly node: Node) {
    super(`${node.type} is not compiled to bytecode yet`);
  }
}

/** What a visited expression is known to produce; decides `ToBoolean` and `ToString` steps. */
type TypeHint = "any" | "boolean" | "string";
type Fallthrough = "then" | "else" | "none";
type ResultKind = "effect" | "value" | "test";

/** V8's ExpressionResultScope: where an expression leaves its value. */
class ResultScope {
  typeHint: TypeHint = "any";
  // Test results only.
  thenLabels!: BytecodeLabels;
  elseLabels!: BytecodeLabels;
  fallthrough: Fallthrough = "none";
  consumed = false;

  constructor(readonly kind: ResultKind) {}
}

/** A loop being compiled; `header` is where its `JumpLoop` returns to. */
type Loop = {
  readonly header: Label;
  readonly breakLabels: BytecodeLabels;
  readonly continueLabels: BytecodeLabels;
  /** Bound just before the loop's closing jump; an inner loop with the same header jumps here. */
  readonly backEdge: BytecodeLabels;
  /** The context in use outside the loop body; break and continue pop back to it. */
  readonly context: ContextScope;
};

/**
 * V8's ControlScope chain, innermost last: who gets to carry out a `break`, `continue`, `return` or
 * rethrow. A try/finally intercepts them all to run its `finally` block first.
 */
type Control =
  | { readonly kind: "loop"; readonly loop: Loop }
  | { readonly kind: "try-catch" }
  | { readonly kind: "try-finally"; readonly commands: DeferredCommands; readonly finalization: BytecodeLabels; readonly context: ContextScope };

/** `HandlerTable::CAUGHT`: the exception is predicted to be caught by the handler. */
const CAUGHT = 1;

/** `HandlerTable::ASYNC_AWAIT`: an exception reaching the handler becomes the rejection of an async function's promise. */
const ASYNC_AWAIT = 3;

/** Where an async function keeps its generator object (V8's `generator_object()`): the first register, ahead of the locals. */
const GENERATOR = local(0);

/** `BytecodeArray::kMaxOsrUrgency - 1`: the deepest loop level a `JumpLoop` reports. */
const MAX_OSR_DEPTH = 5;

/** V8's ContextScope: a context a function has pushed, linked to the one it replaced. */
type ContextScope = { readonly scope: Scope; readonly outer: ContextScope | undefined; register: number };

/** `Context::MIN_CONTEXT_SLOTS`: the slots every context has before its variables. */
const MIN_CONTEXT_SLOTS = 2;

/** V8's AssignmentLhsData: what an assignment or `++` writes to, with the registers its parts were evaluated into. */
type Reference =
  | { readonly kind: "variable" }
  | { readonly kind: "named"; readonly objectExpression: Node; readonly object: number; readonly name: string }
  | { readonly kind: "keyed"; readonly object: number; readonly key: number };

type Entered = { readonly previous: ResultScope; readonly scope: ResultScope; readonly top: number };

const ARITHMETIC: Readonly<Record<string, Opcode>> = {
  "+": "Add",
  "-": "Sub",
  "*": "Mul",
  "/": "Div",
  "%": "Mod",
  "**": "Exp",
  "|": "BitwiseOr",
  "^": "BitwiseXor",
  "&": "BitwiseAnd",
  "<<": "ShiftLeft",
  ">>": "ShiftRight",
  ">>>": "ShiftRightLogical",
};

const SMI_ARITHMETIC: Readonly<Record<string, Opcode>> = {
  "+": "AddSmi",
  "-": "SubSmi",
  "*": "MulSmi",
  "/": "DivSmi",
  "%": "ModSmi",
  "**": "ExpSmi",
  "|": "BitwiseOrSmi",
  "^": "BitwiseXorSmi",
  "&": "BitwiseAndSmi",
  "<<": "ShiftLeftSmi",
  ">>": "ShiftRightSmi",
  ">>>": "ShiftRightLogicalSmi",
};

const COMPARISON: Readonly<Record<string, Opcode>> = {
  "==": "TestEqual",
  "===": "TestEqualStrict",
  "<": "TestLessThan",
  ">": "TestGreaterThan",
  "<=": "TestLessThanOrEqual",
  ">=": "TestGreaterThanOrEqual",
  in: "TestIn",
  instanceof: "TestInstanceOf",
};

/** The literal `typeof x` is compared with, as the operand of `TestTypeOf`. */
const TYPEOF_FLAGS: Readonly<Record<string, number>> = {
  number: 0,
  string: 1,
  symbol: 2,
  boolean: 3,
  bigint: 4,
  undefined: 5,
  function: 6,
  object: 7,
};

/** `a * 2` and `2 * a` are the same to the generator; `+` is not commutative for it (strings). */
const COMMUTATIVE_WITH_SMI_LEFT: ReadonlySet<string> = new Set(["|", "&", "^", "*"]);

type Chain = { readonly operator: string; readonly operands: readonly Expression[]; readonly positions: readonly number[] };

export type FunctionLiteral = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;

/** Compiles the functions a function creates; the program-wide counterpart of one FunctionGenerator. */
export interface FunctionCompiler {
  /**
   * Compiles `node` to bytecode of its own and returns its id. `name` is the SharedFunctionInfo name
   * (inferred or own) and `debugName` the one its bytecode listing is headed with; they differ for
   * `{ f: () => 1 }` assigned to `o`, which is `f` in the pool but `o.f` in the header.
   */
  compile(node: FunctionLiteral, name: string, debugName: string): FunctionId;
}

/** Property names the scanner reads as keywords: V8 does not take them for an identifier before a call's `(`. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "switch", "this", "throw", "true", "try", "typeof",
  "var", "void", "while", "with",
]);

/** `CreateClosureFlags::FastNewClosureBit`: set for every closure made inside a function. */
const FAST_NEW_CLOSURE = 2;

export type FunctionGeneratorOptions = {
  readonly source: string;
  readonly scopes: ScopeTree;
  /** The function scope this generator compiles. */
  readonly scope: Scope;
  readonly functions: FunctionCompiler;
  readonly parameterCount: number;
  readonly localCount: number;
};

export class FunctionGenerator {
  readonly builder: BytecodeArrayBuilder;
  /** The functions this one creates closures for, in constant-pool order. */
  readonly children: FunctionId[] = [];
  private readonly source: string;
  private readonly scopes: ScopeTree;
  private readonly functions: FunctionCompiler;
  private currentScope: Scope;
  private readonly functionScope: Scope;
  private context: ContextScope;
  /** Bindings already checked for the hole on the straight-line path being compiled; a second check would be redundant. */
  private checked = new Set<Variable>();
  /** The function declarations already created at the top of the function. */
  private readonly hoisted = new Set<Node>();
  private result: ResultScope = new ResultScope("effect");
  /** Where an optional link of the chain being visited jumps to when its object is `null` or `undefined`. */
  private optionalLabels: BytecodeLabels | undefined;
  private readonly slotCache = new Map<string, number>();
  private readonly loops: Loop[] = [];
  private readonly controls: Control[] = [];
  /** `HandlerTable::CatchPrediction` of the handler an exception thrown here would reach first. */
  private catchPrediction = 0;
  private readonly isAsync: boolean;
  /** Where each `await` resumes; bound as the suspend points are compiled. Only an async function with an `await` has one. */
  private suspendTable: JumpTable | undefined;
  private suspendCount = 0;

  constructor(options: FunctionGeneratorOptions) {
    this.isAsync = options.scope.isAsync;
    // There is no point in an async function's body where an exception goes uncaught: the outermost handler rejects the promise.
    if (this.isAsync) this.catchPrediction = ASYNC_AWAIT;
    this.source = options.source;
    this.scopes = options.scopes;
    this.functions = options.functions;
    this.currentScope = options.scope;
    this.functionScope = options.scope;
    this.context = { scope: options.scope, outer: undefined, register: CURRENT_CONTEXT };
    this.builder = new BytecodeArrayBuilder({
      parameterCount: options.parameterCount,
      localCount: options.localCount,
      optimizeRegisters: true,
    });
  }

  // Statements.

  /** A function literal's body: its parameters need no code yet, so it is the declarations, the statements and the final return. */
  generateFunction(node: FunctionLiteral): void {
    // A generator's state machine is not built yet; compiled as a plain function it would be wrong.
    if (node.generator) throw new NotYetSupported(node);
    // V8 puts the generator object after the parameters' own locals and initializes them inside the try; not built yet.
    if (node.async && !this.functionScope.hasSimpleParameters) throw new NotYetSupported(node);
    const entry = this.functionStart(node);
    if (node.body.type === "BlockStatement") {
      this.generateBody(node.body.body, endOf(node.body) - 1, entry, node.params);
      return;
    }
    // An arrow's expression body is `return <expression>`, positioned at the expression.
    const b = this.builder;
    this.enterFunction(entry);
    this.initializeParameters(node.params);
    const expression = node.body;
    this.inAsyncTry(() => {
      b.setStatementPosition(this.positionOf(expression));
      this.visitForAccumulatorValue(expression);
      this.buildReturn(endWithParentheses(this.source, expression));
    });
  }

  /** V8's `FunctionLiteral::start_position()`: the `(` of the parameters, or the start of an arrow. */
  private functionStart(node: FunctionLiteral): number {
    // The arrow's own first token, whether or not it is parenthesized.
    if (node.type === "ArrowFunctionExpression") return node.range?.[0] ?? 0;
    const start = node.range?.[0] ?? 0;
    if (node.id) return operatorPosition(this.source, endOf(node.id));
    // A method has no `function` keyword: its node starts at the `(` of its parameters.
    if (this.source[start] === "(") return start;
    const afterAsync = node.async ? operatorPosition(this.source, start + "async".length) : start;
    const afterKeyword = operatorPosition(this.source, afterAsync + "function".length);
    return this.source[afterKeyword] === "*" ? operatorPosition(this.source, afterKeyword + 1) : afterKeyword;
  }

  generateBody(statements: readonly Statement[], returnPosition: number, entryPosition = 0, params: readonly Pattern[] = []): void {
    this.enterFunction(entryPosition);
    this.initializeParameters(params);
    this.visitDeclarations(statements);
    this.inAsyncTry(() => {
      this.visitStatements(statements);
      if (!this.builder.remainderOfBlockIsDead) {
        this.builder.emit("LdaUndefined");
        this.buildReturn(returnPosition);
      }
    });
  }

  /** The function's own context, when something in it is captured; parameters it holds are copied in. */
  private enterFunction(entryPosition: number): void {
    const b = this.builder;
    const scope = this.currentScope;
    // A resumed generator dispatches before anything else runs, so the switch comes ahead of the entry position.
    if (this.isAsync && scope.suspendCount > 0) {
      this.suspendTable = b.allocateJumpTable(scope.suspendCount, 0);
      b.switchOnGeneratorState(GENERATOR, this.suspendTable);
    }
    b.setExpressionPosition(entryPosition);
    if (!scope.needsContext) {
      this.copyClosureName();
      this.createGeneratorObject();
      return;
    }
    b.emit("CreateFunctionContext", b.constantPool.add({ kind: "scope-info", scope: "FUNCTION_SCOPE" }), scope.contextSlots);
    this.pushContext(scope);
    if (scope.thisVariable) {
      b.emit("Ldar", THIS);
      b.emit("StaCurrentContextSlot", this.slotOf(scope.thisVariable));
    }
    this.copyClosureName();
    // With defaults the parameters are set by their initializers instead.
    const parameters = scope.hasSimpleParameters ? scope.variables.filter((v) => v.kind === "param" && v.allocation.kind === "context") : [];
    for (const parameter of parameters.sort((a, c) => (a.parameterIndex ?? 0) - (c.parameterIndex ?? 0))) {
      b.emit("Ldar", argument(parameter.parameterIndex ?? 0));
      b.emit("StaCurrentContextSlot", this.slotOf(parameter));
    }
    this.createGeneratorObject();
  }

  /** V8's BuildGeneratorObjectVariableInitialization: an async function starts by creating the promise and its generator object. */
  private createGeneratorObject(): void {
    if (!this.isAsync) return;
    const b = this.builder;
    const top = b.registerTop;
    const closure = b.allocateRegister();
    b.allocateRegister();
    b.emit("Mov", CLOSURE, local(closure));
    b.emit("Mov", THIS, local(closure + 1));
    b.emit("InvokeIntrinsic", "_AsyncFunctionEnter", local(closure), 2);
    b.emit("Star", GENERATOR);
    b.releaseRegisters(top);
  }

  /**
   * An async function's body runs under a handler that turns whatever is thrown into the rejection
   * of its promise (V8's parser wraps the body in a try/catch for it); any other body runs as it is.
   */
  private inAsyncTry(body: () => void): void {
    if (!this.isAsync) {
      body();
      return;
    }
    const b = this.builder;
    this.buildTryCatch(
      body,
      () => {
        const top = b.registerTop;
        const generator = b.allocateRegister();
        const exception = b.allocateRegister();
        b.emit("Star", local(exception));
        b.emit("LdaTheHole");
        b.emit("SetPendingMessage");
        b.emit("Mov", GENERATOR, local(generator));
        b.emit("InvokeIntrinsic", "_AsyncFunctionReject", local(generator), 2);
        b.emit("Return");
        b.releaseRegisters(top);
      },
      this.catchPrediction,
    );
  }

  /** The return of the value in the accumulator; an async function resolves its promise with it first. */
  private buildReturn(position: number): void {
    const b = this.builder;
    if (this.isAsync) this.resolvePromise();
    b.setStatementPosition(position);
    b.emit("Return");
  }

  /** V8's BuildAsyncReturn: `%_AsyncFunctionResolve(generator, value)`, the value being the accumulator. */
  private resolvePromise(): void {
    const b = this.builder;
    const top = b.registerTop;
    const generator = b.allocateRegister();
    const value = b.allocateRegister();
    b.emit("Star", local(value));
    b.emit("Mov", GENERATOR, local(generator));
    b.emit("InvokeIntrinsic", "_AsyncFunctionResolve", local(generator), 2);
    b.releaseRegisters(top);
  }

  /** A named function expression's own name starts out as the running closure. */
  private copyClosureName(): void {
    const variable = this.currentScope.variables.find((v) => v.kind === "function-name");
    const allocation = variable?.allocation;
    if (allocation?.kind === "register") this.builder.emit("Mov", CLOSURE, local(allocation.index));
    else if (variable && allocation?.kind === "context") {
      this.builder.emit("Ldar", CLOSURE);
      this.builder.emit("StaCurrentContextSlot", this.slotOf(variable));
    }
  }

  /** V8's parameter initialization block, for a list with defaults: each named parameter is set from its raw argument. */
  private initializeParameters(params: readonly Pattern[]): void {
    const scope = this.currentScope;
    if (scope.hasSimpleParameters) return;
    const b = this.builder;
    const parameters = params.map((param, index) => {
      const target = param.type === "AssignmentPattern" ? param.left : param;
      if (target.type !== "Identifier") throw new NotYetSupported(param);
      const variable = this.scopes.declarationOf.get(target);
      if (!variable) throw new Error("parameter without a variable");
      // A body binding that a closure captures needs a block context of its own, which is not built yet.
      return { target, variable, index, initializer: param.type === "AssignmentPattern" ? param.right : undefined };
    });
    if (scope.variables.some((v) => v.kind !== "param" && v.kind !== "this" && v.kind !== "function-name" && v.allocation.kind === "context")) {
      throw new NotYetSupported(scope.node);
    }
    for (const { target, variable } of parameters) {
      if (!variable.needsHoleInit) continue;
      b.emit("LdaTheHole");
      this.storeVariable(variable, target);
    }
    for (const { target, variable, index, initializer } of parameters) {
      b.emit("Ldar", argument(index));
      if (initializer) {
        const useArgument = this.newLabels();
        const done = this.newLabels();
        b.jump("JumpIfNotUndefined", useArgument.new());
        this.conditionally(() => this.visitForAccumulatorValue(initializer, target.name));
        b.jump("Jump", done.new());
        useArgument.bind();
        b.emit("Ldar", argument(index));
        done.bind();
      }
      this.storeVariable(variable, target);
    }
  }

  /** V8's ContextScope constructor: the context in use moves to a fresh register and the new one becomes current. */
  private pushContext(scope: Scope): void {
    const outer = this.context;
    outer.register = local(this.builder.allocateRegister());
    this.builder.emit("PushContext", outer.register);
    this.context = { scope, outer, register: CURRENT_CONTEXT };
  }

  /** V8's VisitDeclarations, in source order: functions are created and bindings that can be read too early get the hole. */
  private visitDeclarations(statements: readonly Statement[]): void {
    for (const statement of statements) {
      if (statement.type === "FunctionDeclaration") {
        // A sloppy block function is also copied to a function-level var, which is not built yet.
        if (this.functionScope.variables.some((v) => v.annexB && v.name === statement.id.name)) throw new NotYetSupported(statement);
        this.hoisted.add(statement);
        this.buildClosure(statement, statement.id.name);
        this.assignToVariable(statement.id, "init");
      } else if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
        for (const declarator of statement.declarations) {
          const variable = declarator.id.type === "Identifier" ? this.scopes.declarationOf.get(declarator.id) : undefined;
          if (!variable?.needsHoleInit) continue;
          this.builder.emit("LdaTheHole");
          this.storeVariable(variable, declarator.id);
        }
      }
    }
  }

  /** V8's VisitBlock: a block whose bindings a closure captures runs in a context of its own, popped when it falls through. */
  private visitBlock(node: BlockStatement): void {
    const scope = this.scopes.scopeOf.get(node);
    if (!scope) {
      this.visitStatements(node.body);
      return;
    }
    const b = this.builder;
    const enclosingScope = this.currentScope;
    const outer = this.context;
    this.currentScope = scope;
    if (scope.needsContext) {
      b.emit("CreateBlockContext", b.constantPool.add({ kind: "scope-info", scope: "BLOCK_SCOPE" }));
      this.pushContext(scope);
    }
    this.visitDeclarations(node.body);
    this.visitStatements(node.body);
    if (scope.needsContext) this.popContext(outer);
    this.currentScope = enclosingScope;
  }

  /** V8's ~ContextScope: back to `outer`, whose context waits in its register. */
  private popContext(outer: ContextScope): void {
    this.builder.emit("PopContext", outer.register);
    outer.register = CURRENT_CONTEXT;
    this.context = outer;
  }

  private visitStatements(statements: readonly Statement[]): void {
    for (const statement of statements) {
      const top = this.builder.registerTop;
      this.visitStatement(statement);
      this.builder.releaseRegisters(top);
      if (this.builder.remainderOfBlockIsDead) break;
    }
  }

  private visitStatement(node: Statement): void {
    switch (node.type) {
      case "EmptyStatement":
        return;
      case "FunctionDeclaration":
        // Created with the other declarations; one nested in a block waits for block scopes.
        if (!this.hoisted.has(node)) throw new NotYetSupported(node);
        return;
      case "ExpressionStatement":
        this.builder.setStatementPosition(startOf(node));
        this.visitForEffect(node.expression);
        return;
      case "VariableDeclaration":
        this.visitVariableDeclaration(node);
        return;
      case "BlockStatement":
        return this.visitBlock(node);
      case "IfStatement":
        return this.visitIf(node);
      case "WhileStatement":
        return this.visitWhile(node);
      case "ForStatement":
        return this.visitFor(node);
      case "BreakStatement":
        return this.jumpOutOfLoop(node, "break");
      case "ContinueStatement":
        return this.jumpOutOfLoop(node, "continue");
      case "ReturnStatement":
        return this.visitReturn(node);
      case "ThrowStatement":
        return this.visitThrow(node);
      case "TryStatement":
        return this.visitTry(node);
      default:
        throw new NotYetSupported(node);
    }
  }

  private visitIf(node: IfStatement): void {
    const b = this.builder;
    const thenLabels = this.newLabels();
    const elseLabels = this.newLabels();
    const endLabels = this.newLabels();
    b.setStatementPosition(startOf(node));
    const condition = toBooleanOf(node.test);
    if (condition === true) {
      thenLabels.bind();
      this.visitStatement(node.consequent);
    } else if (condition === false) {
      elseLabels.bind();
      if (node.alternate) this.visitStatement(node.alternate);
    } else {
      this.visitForTest(node.test, thenLabels, elseLabels, "then");
      this.mergeBranches(
        () => {
          thenLabels.bind();
          this.visitStatement(node.consequent);
          if (node.alternate) b.jump("Jump", endLabels.new());
        },
        () => {
          if (!node.alternate) return;
          elseLabels.bind();
          this.visitStatement(node.alternate);
        },
      );
    }
    if (!elseLabels.bound) elseLabels.bind();
    endLabels.bind();
  }

  private visitReturn(node: ReturnStatement): void {
    const b = this.builder;
    b.setStatementPosition(startOf(node));
    if (node.argument) this.visitForAccumulatorValue(node.argument);
    else b.emit("LdaUndefined");
    this.performCommand({ kind: "return" }, endOf(node));
  }

  private visitThrow(node: ThrowStatement): void {
    const b = this.builder;
    b.setStatementPosition(startOf(node));
    this.visitForAccumulatorValue(node.argument);
    b.setExpressionPosition(startOf(node));
    b.emit("Throw");
  }

  // Loops and jump targets.

  private beginLoop(): Loop {
    const loop: Loop = { header: this.builder.newLabel(), continueLabels: this.newLabels(), backEdge: this.newLabels(), breakLabels: this.newLabels(), context: this.context };
    this.loops.push(loop);
    this.controls.push({ kind: "loop", loop });
    return loop;
  }

  private endLoop(loop: Loop): void {
    this.controls.pop();
    this.loops.pop();
    loop.breakLabels.bind();
  }

  /** `break` or `continue`: handed to the control scopes, which leave the contexts and finally blocks in the way. */
  private jumpOutOfLoop(node: Node, kind: "break" | "continue"): void {
    const loop = this.innermostLoop();
    this.builder.setStatementPosition(startOf(node));
    this.performCommand({ kind, target: loop });
  }

  /**
   * V8's ControlScope::PerformCommand: the innermost scope that takes the command carries it out;
   * the function level returns or rethrows. `position` is the source position of a return.
   */
  private performCommand(command: Command, position?: number): void {
    const b = this.builder;
    for (let i = this.controls.length - 1; i >= 0; i--) {
      const control = this.controls[i] as Control;
      switch (control.kind) {
        case "loop":
          if (command.kind === "return" || command.kind === "rethrow" || command.target !== control.loop) continue;
          this.popContextTo(control.loop.context);
          b.jump("Jump", (command.kind === "break" ? control.loop.breakLabels : control.loop.continueLabels).new());
          return;
        case "try-catch":
          if (command.kind !== "rethrow") continue;
          // Execution re-enters the function through the handler table, which restores the context.
          b.emit("ReThrow");
          return;
        case "try-finally":
          this.popContextTo(control.context);
          // The return position is dropped: the return runs after the finally block, with none.
          control.commands.recordCommand(command);
          b.jump("Jump", control.finalization.new());
          return;
      }
    }
    if (command.kind === "return") {
      if (this.isAsync) this.resolvePromise();
      if (position !== undefined) b.setStatementPosition(position);
      b.emit("Return");
    } else if (command.kind === "rethrow") {
      b.emit("ReThrow");
    } else {
      throw new Error("break or continue outside a loop");
    }
  }

  /** V8's PopContextToExpectedDepth: a single PopContext reaches any enclosing context, whatever the number pushed since. */
  private popContextTo(expected: ContextScope): void {
    if (this.context !== expected) this.builder.emit("PopContext", expected.register);
  }

  // try / catch / finally.

  private visitTry(node: TryStatement): void {
    const { block, handler, finalizer } = node;
    if (finalizer) {
      // With both, the parser wraps a try/catch in the try block of the try/finally. That block
      // holds the try/catch as a statement, so the registers it takes are released after it.
      this.buildTryFinally(
        () => (handler ? this.visitStatements([{ ...node, finalizer: null }]) : this.visitBlock(block)),
        () => this.visitBlock(finalizer),
        this.catchPrediction,
      );
    } else if (handler) {
      this.visitTryCatch(block, handler);
    }
  }

  private visitTryCatch(block: BlockStatement, handler: CatchClause): void {
    if (handler.param && handler.param.type !== "Identifier") throw new NotYetSupported(handler.param);
    const b = this.builder;
    // A try/catch is predicted to catch; the prediction holds for its try block only.
    const outerPrediction = this.catchPrediction;
    this.catchPrediction = CAUGHT;
    this.buildTryCatch(
      () => {
        this.visitBlock(block);
        this.catchPrediction = outerPrediction;
      },
      (context) => {
        const scope = this.scopes.scopeOf.get(handler);
        if (scope) {
          // Binds the exception in a context of its own.
          const exception = b.allocateRegister();
          b.emit("Star", local(exception));
          b.emit("CreateCatchContext", local(exception), b.constantPool.add({ kind: "scope-info", scope: "CATCH_SCOPE" }));
          b.releaseRegisters(exception);
          b.emit("Star", local(context));
        }
        // The message belongs to the exception being caught: clear it.
        b.emit("LdaTheHole");
        b.emit("SetPendingMessage");
        b.emit("Ldar", local(context));
        if (scope) this.visitInCatchScope(handler.body, scope);
        else this.visitBlock(handler.body);
      },
      CAUGHT,
    );
  }

  /** V8's VisitInScope for the catch scope: its context is pushed, the body runs, the context is popped. */
  private visitInCatchScope(body: BlockStatement, scope: Scope): void {
    const enclosingScope = this.currentScope;
    const outer = this.context;
    this.currentScope = scope;
    this.pushContext(scope);
    this.visitBlock(body);
    this.popContext(outer);
    this.currentScope = enclosingScope;
  }

  /** V8's BuildTryCatch: the try block runs under a handler table row; the handler enters `catchBody` with the context to restore. */
  private buildTryCatch(tryBody: () => void, catchBody: (context: number) => void, prediction: number): void {
    const b = this.builder;
    if (b.remainderOfBlockIsDead) return;
    const handler = b.newHandlerEntry();
    const exit = this.newLabels();
    // The handler gets the context back from this register, wherever in the try block the exception came from.
    const context = b.allocateRegister();
    b.emit("Mov", CURRENT_CONTEXT, local(context));
    b.markTryBegin(handler, context);
    this.mergeBranches(
      () => {
        this.controls.push({ kind: "try-catch" });
        tryBody();
        this.controls.pop();
        b.markTryEnd(handler);
        b.jump("Jump", exit.new());
        b.markHandler(handler, prediction);
      },
      () => catchBody(context),
    );
    exit.bind();
  }

  /** V8's BuildTryFinally: every way out of the try block records a token, and the dispatch after the finally block follows it. */
  private buildTryFinally(tryBody: () => void, finallyBody: () => void, prediction: number): void {
    const b = this.builder;
    if (b.remainderOfBlockIsDead) return;
    const handler = b.newHandlerEntry();
    const finalization = this.newLabels();
    const token = local(b.allocateRegister());
    const result = local(b.allocateRegister());
    const message = local(b.allocateRegister());
    b.emit("LdaTheHole");
    b.emit("Star", message);
    const commands = new DeferredCommands(b, { token, result, message }, (command) => this.performCommand(command));
    const context = b.allocateRegister();
    b.emit("Mov", CURRENT_CONTEXT, local(context));
    b.markTryBegin(handler, context);
    this.controls.push({ kind: "try-finally", commands, finalization, context: this.context });
    // The try block can throw anywhere, so what it checked is not known to be checked afterwards.
    this.conditionally(tryBody);
    this.controls.pop();
    b.markTryEnd(handler);
    if (!b.remainderOfBlockIsDead) commands.recordFallThroughPath();
    b.jump("Jump", finalization.new());
    b.markHandler(handler, prediction);
    commands.recordHandlerRethrowPath();
    finalization.bind();
    finallyBody();
    commands.applyDeferredCommands();
  }

  private innermostLoop(): Loop {
    const loop = this.loops.at(-1);
    if (!loop) throw new Error("break or continue outside a loop");
    return loop;
  }

  /** The loop that directly encloses the one being compiled. */
  private parentLoop(): Loop | undefined {
    return this.loops.at(-2);
  }

  /** V8's LoopBuilder::JumpToHeader. */
  private jumpToHeader(loop: Loop, position: number): void {
    const b = this.builder;
    const parent = this.parentLoop();
    loop.backEdge.bind();
    if (parent && parent.header.index === loop.header.index) {
      // Both loops start at the same offset, so one JumpLoop (the parent's) serves them both.
      b.jump("Jump", parent.backEdge.new());
      return;
    }
    const depth = Math.min(this.loops.length - 1, MAX_OSR_DEPTH);
    b.jumpLoop(loop.header, depth, b.feedback.addSlot("jump-loop"), position);
  }

  /** Tests the loop condition at the top of an iteration, unless there is none or it is always true. */
  private visitLoopTest(test: Expression | null | undefined, loop: Loop): void {
    if (!test || toBooleanOf(test) === true) return;
    const body = this.newLabels();
    this.builder.setStatementPosition(this.positionOf(test));
    this.visitForTest(test, body, loop.breakLabels, "then");
    body.bind();
  }

  private visitIterationBody(body: Statement, loop: Loop): void {
    this.visitStatement(body);
    loop.continueLabels.bind();
  }

  private visitWhile(node: WhileStatement): void {
    const loop = this.beginLoop();
    if (toBooleanOf(node.test) !== false) {
      this.builder.bindLoopHeader(loop.header);
      this.visitLoopTest(node.test, loop);
      this.conditionally(() => this.visitIterationBody(node.body, loop));
      this.jumpToHeader(loop, startOf(node));
    }
    this.endLoop(loop);
  }

  private visitFor(node: ForStatement): void {
    // Each iteration gets a context of its own (V8 copies the bindings), which is not built yet.
    if (this.scopes.scopeOf.get(node)?.perIteration) throw new NotYetSupported(node);
    const init = node.init;
    if (init?.type === "VariableDeclaration") this.visitVariableDeclaration(init);
    else if (init) {
      this.builder.setStatementPosition(startOf(init));
      this.visitForEffect(init);
    }
    const loop = this.beginLoop();
    if (!node.test || toBooleanOf(node.test) !== false) {
      this.builder.bindLoopHeader(loop.header);
      this.visitLoopTest(node.test, loop);
      this.conditionally(() => {
        this.visitIterationBody(node.body, loop);
        if (node.update) {
          this.builder.setStatementPosition(this.positionOf(node.update));
          this.visitForEffect(node.update);
        }
      });
      this.jumpToHeader(loop, startOf(node));
    }
    this.endLoop(loop);
  }

  private visitVariableDeclaration(node: VariableDeclaration): void {
    for (const declarator of node.declarations) {
      const target = declarator.id;
      if (target.type !== "Identifier") throw new NotYetSupported(target);
      const init = declarator.init;
      let position: number;
      if (init) position = startOf(init);
      else if (node.kind === "let") position = startOf(target); // `let x;` assigns undefined at the name
      else continue;
      const top = this.builder.registerTop;
      this.builder.setStatementPosition(position);
      const entered = this.enter("effect");
      if (init) this.visitForAccumulatorValue(init, target.name);
      else this.builder.emit("LdaUndefined");
      this.builder.setExpressionPosition(position);
      this.assignToVariable(target, "init");
      this.leave(entered);
      this.builder.releaseRegisters(top);
    }
  }

  // Result scopes.

  private enter(kind: ResultKind): Entered {
    const previous = this.result;
    const scope = new ResultScope(kind);
    this.result = scope;
    return { previous, scope, top: this.builder.registerTop };
  }

  private leave(entered: Entered): void {
    this.result = entered.previous;
    this.builder.releaseRegisters(entered.top);
  }

  private visitForEffect(expression: Expression): void {
    const entered = this.enter("effect");
    this.visitExpression(expression);
    this.leave(entered);
  }

  /** `inferredName` names an anonymous function literal after what it is assigned to (V8's FuncNameInferrer). */
  private visitForAccumulatorValue(expression: Expression, inferredName = "", debugName = inferredName): TypeHint {
    const entered = this.enter("value");
    this.visitExpression(expression, inferredName, debugName);
    this.leave(entered);
    return entered.scope.typeHint;
  }

  /** Evaluates into the accumulator, then a register taken after the visit (in the caller's scope). */
  private visitForRegisterValue(expression: Expression): number {
    this.visitForAccumulatorValue(expression);
    const register = this.builder.allocateRegister();
    this.builder.emit("Star", local(register));
    return register;
  }

  private visitForTest(expression: Expression, thenLabels: BytecodeLabels, elseLabels: BytecodeLabels, fallthrough: Fallthrough): void {
    const entered = this.enter("test");
    const scope = entered.scope;
    scope.thenLabels = thenLabels;
    scope.elseLabels = elseLabels;
    scope.fallthrough = fallthrough;
    this.visitExpression(expression);
    this.leave(entered);
    if (!scope.consumed) this.buildTest(scope);
  }

  /** Visits `expression` in the test scope that is already current. */
  private visitInSameTestScope(expression: Expression): void {
    const scope = this.result;
    const top = this.builder.registerTop;
    this.visitExpression(expression);
    this.builder.releaseRegisters(top);
    if (!scope.consumed) {
      this.buildTest(scope);
      scope.consumed = true;
    }
  }

  private buildTest(scope: ResultScope): void {
    const alreadyBoolean = scope.typeHint === "boolean";
    const b = this.builder;
    switch (scope.fallthrough) {
      case "then":
        b.jump(alreadyBoolean ? "JumpIfFalse" : "JumpIfToBooleanFalse", scope.elseLabels.new());
        break;
      case "else":
        b.jump(alreadyBoolean ? "JumpIfTrue" : "JumpIfToBooleanTrue", scope.thenLabels.new());
        break;
      case "none":
        b.jump(alreadyBoolean ? "JumpIfTrue" : "JumpIfToBooleanTrue", scope.thenLabels.new());
        b.jump("Jump", scope.elseLabels.new());
        break;
    }
  }

  private jumpIfTrue(hint: TypeHint, labels: BytecodeLabels): void {
    this.builder.jump(hint === "boolean" ? "JumpIfTrue" : "JumpIfToBooleanTrue", labels.new());
  }

  private jumpIfFalse(hint: TypeHint, labels: BytecodeLabels): void {
    this.builder.jump(hint === "boolean" ? "JumpIfFalse" : "JumpIfToBooleanFalse", labels.new());
  }

  private setResultIsBoolean(): void {
    this.result.typeHint = "boolean";
  }

  private setResultIsString(): void {
    this.result.typeHint = "string";
  }

  private newLabels(): BytecodeLabels {
    return new BytecodeLabels(this.builder);
  }

  // Expressions.

  private visitExpression(node: Expression, inferredName = "", debugName = inferredName): void {
    // V8's parser has already folded literals by the time the generator runs.
    const literal = literalOf(node);
    if (literal) return this.visitLiteralValue(literal);
    switch (node.type) {
      case "Identifier":
        this.builder.setExpressionPosition(startOf(node));
        return this.loadIdentifier(node, false);
      case "ThisExpression": {
        const receiver = this.scopes.thisOf.get(node);
        if (receiver) this.loadVariable(receiver, node);
        else this.builder.emit("Ldar", THIS);
        return;
      }
      case "UnaryExpression":
        return this.visitUnary(node);
      case "BinaryExpression":
        return this.visitBinary(node);
      case "LogicalExpression":
        return this.visitLogical(node);
      case "ConditionalExpression":
        return this.visitConditional(node);
      case "SequenceExpression":
        return this.visitSequence(node.expressions);
      case "AssignmentExpression":
        return this.visitAssignment(node);
      case "UpdateExpression":
        return this.visitUpdate(node);
      case "TemplateLiteral":
        return this.visitTemplateLiteral(node);
      case "AwaitExpression":
        return this.visitAwait(node);
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.type === "FunctionExpression" && node.id) this.buildClosure(node, node.id.name, node.id.name);
        else this.buildClosure(node, inferredName, debugName);
        return;
      case "ObjectExpression":
        return this.visitObjectLiteral(node, debugName);
      case "ArrayExpression":
        return this.visitArrayLiteral(node, inferredName, debugName);
      case "CallExpression":
        return this.visitCall(node);
      case "NewExpression":
        return this.visitNew(node);
      case "MemberExpression":
        return this.visitMember(node);
      case "ChainExpression":
        return this.visitChain(node);
      default:
        throw new NotYetSupported(node);
    }
  }

  private visitAwait(node: AwaitExpression): void {
    // At the `await` keyword, even inside parentheses.
    const position = node.range?.[0] ?? 0;
    this.builder.setExpressionPosition(position);
    this.visitForAccumulatorValue(node.argument);
    this.buildAwait(position);
  }

  /**
   * V8's BuildAwait: hands the value to the promise machinery, suspends the generator and, once it
   * is resumed with the settled value, either continues with it or rethrows it.
   */
  private buildAwait(position: number): void {
    const b = this.builder;
    const table = this.suspendTable;
    if (!table) throw new Error("await in a function that has no suspend points");
    const top = b.registerTop;
    const generator = b.allocateRegister();
    const value = b.allocateRegister();
    b.emit("Star", local(value));
    b.emit("Mov", GENERATOR, local(generator));
    b.emit("InvokeIntrinsic", "_AsyncFunctionAwait", local(generator), 2);
    b.releaseRegisters(top);

    // BuildSuspendPoint: every live register is saved, and restored when execution resumes here.
    const suspendId = this.suspendCount++;
    const live = b.registerTop;
    b.setExpressionPosition(position);
    b.emit("SuspendGenerator", GENERATOR, local(0), live, suspendId);
    b.bindJumpTableEntry(table, suspendId);
    b.emit("ResumeGenerator", GENERATOR, local(0), live);

    const input = b.allocateRegister();
    const resumeMode = b.allocateRegister();
    b.emit("Star", local(input));
    b.emit("InvokeIntrinsic", "_GeneratorGetResumeMode", GENERATOR, 1);
    b.emit("Star", local(resumeMode));
    b.emit("LdaZero"); // JSGeneratorObject::kNext
    b.emit("TestReferenceEqual", local(resumeMode));
    const resumeNext = this.newLabels();
    b.jump("JumpIfTrue", resumeNext.new());
    // Resumed with a throw completion: rethrow the received value.
    b.emit("Ldar", local(input));
    b.emit("ReThrow");
    resumeNext.bind();
    b.emit("Ldar", local(input));
  }

  private visitLiteralValue(literal: LiteralValue): void {
    if (this.result.kind === "effect") return;
    const b = this.builder;
    switch (literal.kind) {
      case "number":
        if (isSmi(literal.value)) {
          if (literal.value === 0) b.emit("LdaZero");
          else b.emit("LdaSmi", literal.value);
        } else {
          b.emit("LdaConstant", b.constantPool.add({ kind: "number", value: literal.value }));
        }
        return;
      case "string":
        b.emit("LdaConstant", this.stringConstant(literal.value, literal.folded));
        this.setResultIsString();
        return;
      case "boolean":
        b.emit(literal.value ? "LdaTrue" : "LdaFalse");
        this.setResultIsBoolean();
        return;
      case "null":
        b.emit("LdaNull");
        return;
      case "bigint":
        b.emit("LdaConstant", b.constantPool.add({ kind: "bigint", text: literal.text }));
        return;
    }
  }

  private stringConstant(value: string, folded = false): number {
    return this.builder.constantPool.add(folded ? { kind: "string", value, folded } : { kind: "string", value });
  }

  // Functions and calls.

  /** V8's BuildClosure: `CreateClosure` of the function's SharedFunctionInfo, left in the accumulator. */
  private buildClosure(node: FunctionLiteral, name: string, debugName = name): void {
    const b = this.builder;
    const id = this.functions.compile(node, name, debugName);
    this.children.push(id);
    const index = b.constantPool.add({ kind: "sfi", name, functionId: id });
    b.emit("CreateClosure", index, b.feedback.addClosureCell(), FAST_NEW_CLOSURE);
  }

  /**
   * V8's call position: when the token before `(` is an identifier (`f(` or `o.f(`) the call sits at
   * that name, for anything else (`o[k](`, `(f)(`, `f()(`) at the `(`.
   */
  private callPosition(node: SimpleCallExpression): number {
    const callee = node.callee;
    // The token before the `(` of `f?.()` is the `?.`, which is no name.
    if (node.optional) return this.source.indexOf("(", operatorPosition(this.source, endOf(callee)));
    if (callee.type === "Identifier") return startOf(callee);
    if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && !this.isParenthesized(callee) && !RESERVED_WORDS.has(callee.property.name)) {
      return startOf(callee.property);
    }
    return operatorPosition(this.source, endOf(callee));
  }

  private isParenthesized(node: Node): boolean {
    return (node as { extra?: { parenthesized?: boolean } }).extra?.parenthesized === true;
  }

  /** A call: the callee is a name or any other expression (receiver `undefined`), or a property (receiver is its object). */
  private visitCall(node: SimpleCallExpression): void {
    const callee = node.callee;
    if (callee.type === "Super") throw new NotYetSupported(node);
    const b = this.builder;
    const top = b.registerTop;
    const calleeRegister = b.allocateRegister();
    const args: number[] = [];
    const member = callee.type === "MemberExpression" ? callee : undefined;
    if (member) {
      if (member.object.type === "Super") throw new NotYetSupported(node);
      // The receiver is the first register of the argument list; the callee is loaded from it.
      this.visitForAccumulatorValue(member.object);
      const receiver = b.allocateRegister();
      b.emit("Star", local(receiver));
      args.push(receiver);
      this.jumpIfOptionalNullish(member);
      this.loadProperty(receiver, member);
    } else {
      this.visitForAccumulatorValue(callee);
    }
    b.emit("Star", local(calleeRegister));
    this.jumpIfOptionalNullish(node);
    for (const argument of node.arguments) {
      if (argument.type === "SpreadElement") throw new NotYetSupported(argument);
      this.visitForAccumulatorValue(argument);
      const register = b.allocateRegister();
      b.emit("Star", local(register));
      args.push(register);
    }
    const slot = b.feedback.addSlot("call");
    b.setExpressionPosition(this.callPosition(node));
    const target = local(calleeRegister);
    const regs = args.map(local);
    const [first = 0, second = 0, third = 0] = regs;
    if (member) {
      if (regs.length === 1) b.emit("CallProperty0", target, first, slot);
      else if (regs.length === 2) b.emit("CallProperty1", target, first, second, slot);
      else if (regs.length === 3) b.emit("CallProperty2", target, first, second, third, slot);
      else b.emit("CallProperty", target, first, regs.length, slot);
    } else if (regs.length === 0) b.emit("CallUndefinedReceiver0", target, slot);
    else if (regs.length === 1) b.emit("CallUndefinedReceiver1", target, first, slot);
    else if (regs.length === 2) b.emit("CallUndefinedReceiver2", target, first, second, slot);
    else b.emit("CallUndefinedReceiver", target, first, regs.length, slot);
    b.releaseRegisters(top);
  }

  /** V8's VisitCallNew: the constructor is also the new target, left in the accumulator for `Construct`. */
  private visitNew(node: NewExpression): void {
    if (node.callee.type === "Super") throw new NotYetSupported(node);
    const b = this.builder;
    const top = b.registerTop;
    const constructor = this.visitForRegisterValue(node.callee);
    const args: number[] = [];
    for (const argument of node.arguments) {
      if (argument.type === "SpreadElement") throw new NotYetSupported(argument);
      this.visitForAccumulatorValue(argument);
      const register = b.allocateRegister();
      b.emit("Star", local(register));
      args.push(register);
    }
    b.setExpressionPosition(startOf(node));
    b.emit("Ldar", local(constructor));
    const slot = b.feedback.addSlot("call");
    b.emit("Construct", local(constructor), local(args[0] ?? 0), args.length, slot);
    b.releaseRegisters(top);
  }

  // Properties.

  /** A property name V8's parser makes a named access of: `o.a` and `o["a"]`, but not `o[0]`. */
  private namedKeyOf(node: MemberExpression): string | undefined {
    if (node.property.type === "PrivateIdentifier") throw new NotYetSupported(node);
    if (!node.computed) return node.property.type === "Identifier" ? node.property.name : undefined;
    const property = node.property;
    if (property.type !== "Literal" || typeof property.value !== "string") return undefined;
    return isArrayIndex(property.value) ? undefined : property.value;
  }

  /**
   * V8's `Property::position()`: the name of `o.a`, the `[` of `o[k]`. A `.` that follows a call is
   * parsed by another loop of the parser, which records the dot itself; so does one that follows an optional link.
   */
  private memberPosition(node: MemberExpression): number {
    const at = operatorPosition(this.source, endOf(node.object));
    // `o?.[k]` is positioned at its `[`, `o?.a` at the `?.`.
    if (node.optional) return node.computed ? this.source.indexOf("[", at) : at;
    if (node.computed || this.followsCall(node)) return at;
    return startOf(node.property);
  }

  /** Whether a call or an optional link lies in the chain of members `node` is applied to (without parentheses in between). */
  private followsCall(node: MemberExpression): boolean {
    let object: Expression | Node = node.object;
    while (!this.isParenthesized(object)) {
      if (object.type === "CallExpression") return true;
      if (object.type !== "MemberExpression") return false;
      if (object.optional) return true;
      object = object.object;
    }
    return false;
  }

  private visitMember(node: MemberExpression): void {
    if (node.object.type === "Super") throw new NotYetSupported(node);
    const object = this.visitForRegisterValue(node.object);
    this.jumpIfOptionalNullish(node);
    this.loadProperty(object, node);
  }

  /** V8's VisitOptionalChain: a link that finds `null` or `undefined` skips the rest of the chain, which then yields `undefined`. */
  private visitChain(node: ChainExpression): void {
    const b = this.builder;
    const outer = this.optionalLabels;
    const nullish = this.newLabels();
    const done = this.newLabels();
    this.optionalLabels = nullish;
    this.visitForAccumulatorValue(node.expression);
    this.optionalLabels = outer;
    b.jump("Jump", done.new());
    nullish.bind();
    b.emit("LdaUndefined");
    done.bind();
  }

  /** The `?.` of an optional link: leaves the chain when the value in the accumulator is `null` or `undefined`. */
  private jumpIfOptionalNullish(link: MemberExpression | SimpleCallExpression): void {
    if (!link.optional) return;
    if (!this.optionalLabels) throw new NotYetSupported(link);
    this.builder.jump("JumpIfUndefinedOrNull", this.optionalLabels.new());
  }

  /** Loads `node`'s property of the object in `object` into the accumulator (V8's VisitPropertyLoad). */
  private loadProperty(object: number, node: MemberExpression): void {
    const b = this.builder;
    const name = this.namedKeyOf(node);
    if (name !== undefined) {
      const slot = this.cachedPropertySlot("load", node.object, name);
      b.setExpressionPosition(this.memberPosition(node));
      b.emit("GetNamedProperty", local(object), this.stringConstant(name), slot);
    } else {
      this.visitForAccumulatorValue(node.property as Expression);
      b.setExpressionPosition(this.memberPosition(node));
      b.emit("GetKeyedProperty", local(object), b.feedback.addSlot("load"));
    }
  }

  /**
   * V8's GetCachedLoadICSlot / GetCachedStoreICSlot: accesses of the same name on the same variable
   * share one feedback slot. The key is the variable's storage index, as in V8, so unrelated
   * variables with the same index and any two globals share a slot too.
   */
  private cachedPropertySlot(kind: "load" | "store", object: Node, name: string): number {
    if (object.type !== "Identifier") return this.builder.feedback.addSlot(kind);
    const variable = this.scopes.referenceOf.get(object)?.resolved;
    let index = -1;
    if (variable && variable !== "global") {
      const allocation = variable.allocation;
      index = allocation.kind === "context" ? allocation.index + MIN_CONTEXT_SLOTS : allocation.kind === "unused" ? -1 : allocation.index;
    }
    return this.cachedSlot(`${kind}-property:${index}:${name}`, kind);
  }

  /** `delete o.a` and `delete o[k]`: the key goes to the accumulator, the object stays in a register. */
  private visitDelete(node: UnaryExpression): void {
    const operand = node.argument;
    if (operand.type !== "MemberExpression" || operand.optional || operand.object.type === "Super") throw new NotYetSupported(node);
    const object = this.visitForRegisterValue(operand.object);
    const name = this.namedKeyOf(operand);
    if (name !== undefined) this.builder.emit("LdaConstant", this.stringConstant(name));
    else this.visitForAccumulatorValue(operand.property as Expression);
    this.builder.emit(this.currentScope.strict ? "DeletePropertyStrict" : "DeletePropertySloppy", local(object));
  }

  // Object and array literals.

  /**
   * V8's VisitObjectLiteral: the constant part of the literal comes from its boilerplate, the
   * properties with run-time values are defined one by one on a copy. `path` is the name the literal is
   * reachable under (`o` for `var o = { ... }`), which function values are named after.
   */
  private visitObjectLiteral(node: ObjectExpression, path: string): void {
    const b = this.builder;
    for (const property of node.properties) {
      if (property.type === "SpreadElement" || property.computed || property.kind !== "init") throw new NotYetSupported(property);
      if (property.key.type === "Identifier" && property.key.name === "__proto__" && !property.shorthand && !property.method) throw new NotYetSupported(property);
    }
    if (node.properties.length === 0) {
      b.emit("CreateEmptyObjectLiteral");
      return;
    }
    const entry = b.constantPool.add({ kind: "boilerplate", text: objectBoilerplateText(node) });
    b.emit("CreateObjectLiteral", entry, b.feedback.addSlot("literal"), objectFlags(node));
    const literal = b.allocateRegister();
    b.emit("Star", local(literal));
    for (const property of node.properties) {
      if (property.type !== "Property") continue;
      const value = property.value as Expression;
      if (isCompileTimeValue(value)) continue;
      const name = this.propertyNameOf(property);
      if (name === undefined || elementIndexOf(property) !== undefined) throw new NotYetSupported(property);
      // A method's function literal starts where the method does (its `async` keyword, else its name), not at its parameter list.
      b.setExpressionPosition(property.method ? (property.range?.[0] ?? startOf(property.key)) : this.positionOf(value));
      // A method keeps its own name in the header; any other anonymous function is named `path.key`.
      const qualified = path === "" ? name : `${path}.${name}`;
      this.visitForAccumulatorValue(value, name, property.method ? name : qualified);
      b.emit("DefineNamedOwnProperty", local(literal), this.stringConstant(name), b.feedback.addSlot("store"));
    }
    b.emit("Ldar", local(literal));
  }

  /** The string an object-literal key stands for, when it is written as a name or a string. */
  private propertyNameOf(property: Property): string | undefined {
    const key = property.key;
    if (key.type === "Identifier") return key.name;
    if (key.type === "Literal" && typeof key.value === "string") return key.value;
    return undefined;
  }

  /** V8's VisitArrayLiteral: constant elements come from the boilerplate, the others are stored by index. */
  private visitArrayLiteral(node: ArrayExpression, inferredName: string, debugName: string): void {
    const b = this.builder;
    for (const element of node.elements) {
      if (element?.type === "SpreadElement") throw new NotYetSupported(element);
    }
    if (node.elements.length === 0) {
      b.emit("CreateEmptyArrayLiteral", b.feedback.addSlot("literal"));
      return;
    }
    const entry = b.constantPool.add({ kind: "boilerplate", text: arrayBoilerplateText(node) });
    b.emit("CreateArrayLiteral", entry, b.feedback.addSlot("literal"), arrayFlags(node));
    const literal = b.allocateRegister();
    b.emit("Star", local(literal));
    let storeSlot: number | undefined;
    node.elements.forEach((element, position) => {
      if (!element || element.type === "SpreadElement" || isCompileTimeValue(element)) return;
      const top = b.registerTop;
      const index = b.allocateRegister();
      if (position === 0) b.emit("LdaZero");
      else b.emit("LdaSmi", position);
      b.emit("Star", local(index));
      this.visitForAccumulatorValue(element, inferredName, debugName);
      // One slot serves every store of the literal, taken once the first value has been visited.
      storeSlot ??= b.feedback.addSlot("store");
      b.emit("StaInArrayLiteral", local(literal), local(index), storeSlot);
      b.releaseRegisters(top);
    });
    b.emit("Ldar", local(literal));
  }

  // Variables.

  private referenceOf(identifier: Identifier): ReferenceInfo {
    const reference = this.scopes.referenceOf.get(identifier);
    if (!reference) throw new NotYetSupported(identifier);
    return reference;
  }

  private cachedSlot(key: string, kind: FeedbackSlotKind): number {
    let slot = this.slotCache.get(key);
    if (slot === undefined) {
      slot = this.builder.feedback.addSlot(kind);
      this.slotCache.set(key, slot);
    }
    return slot;
  }

  private loadIdentifier(identifier: Identifier, insideTypeof: boolean): void {
    const reference = this.referenceOf(identifier);
    const variable = reference.resolved;
    if (variable === "global") {
      if (identifier.name === "undefined") {
        this.builder.emit("LdaUndefined");
        return;
      }
      const slot = this.cachedSlot(`load:${insideTypeof ? "typeof" : "plain"}:${identifier.name}`, "global-load");
      this.builder.emit(insideTypeof ? "LdaGlobalInsideTypeof" : "LdaGlobal", this.stringConstant(identifier.name), slot);
      return;
    }
    // A value the accumulator still holds is not loaded again, and has been checked already.
    if (this.loadVariable(variable, identifier)) return;
    if (reference.needsTdzCheck) this.checkForHole(variable, identifier.name);
  }

  /** Code that may be skipped: what it checks is not known to be checked afterwards. */
  private conditionally(run: () => void): void {
    const before = new Set(this.checked);
    run();
    this.checked = before;
  }

  /** V8's HoleCheckElisionMergeScope: each alternative starts from the same knowledge; afterwards only what all of them checked holds. */
  private mergeBranches(...alternatives: (() => void)[]): void {
    const before = this.checked;
    let merged: Set<Variable> | undefined;
    for (const run of alternatives) {
      this.checked = new Set(before);
      run();
      const done = this.checked;
      merged = merged ? new Set([...merged].filter((v) => done.has(v))) : done;
    }
    this.checked = merged ?? before;
  }

  /** `ThrowReferenceErrorIfHole` for the value in the accumulator, unless the binding was checked already on this path. */
  private checkForHole(variable: Variable, name: string): void {
    if (this.checked.has(variable)) return;
    this.checked.add(variable);
    this.builder.emit("ThrowReferenceErrorIfHole", this.stringConstant(name));
  }

  /**
   * `forceMutable` is the hole check of an assignment, which loads the slot as mutable even for a
   * const. Returns true when nothing was emitted because the accumulator already holds the value.
   */
  private loadVariable(variable: Variable, at: Node, forceMutable = false): boolean {
    const allocation = variable.allocation;
    switch (allocation.kind) {
      case "register":
        this.builder.emit("Ldar", local(allocation.index));
        return false;
      case "parameter":
        this.builder.emit("Ldar", argument(allocation.index));
        return false;
      case "context": {
        const { register, depth } = this.contextAccess(variable);
        const slot = this.slotOf(variable);
        const immutable = !variable.maybeAssigned && !forceMutable;
        if (immutable && this.builder.isVariableInAccumulator(variable)) return true;
        if (register === CURRENT_CONTEXT && depth === 0) {
          this.builder.emit(immutable ? "LdaImmutableCurrentContextSlot" : "LdaCurrentContextSlot", slot);
        } else {
          this.builder.emit(immutable ? "LdaImmutableContextSlot" : "LdaContextSlot", register, slot, depth);
        }
        if (immutable) this.builder.setVariableInAccumulator(variable);
        return false;
      }
      default:
        throw new NotYetSupported(at);
    }
  }

  private slotOf(variable: Variable): number {
    return variable.allocation.kind === "context" ? variable.allocation.index + MIN_CONTEXT_SLOTS : 0;
  }

  /**
   * V8's context chain walk: the register holding the context `variable` lives in, and how many
   * `previous` hops from it. Contexts this function pushed are in registers; beyond them the walk
   * starts at the context the closure was created in.
   */
  private contextAccess(variable: Variable): { register: number; depth: number } {
    let depth = 0;
    for (let scope: Scope | null = this.context.scope; scope && scope !== variable.scope; scope = scope.parent) {
      if (scope.needsContext) depth++;
    }
    let found: ContextScope | undefined = this.context;
    for (let hops = depth; hops > 0 && found; hops--) found = found.outer;
    return found ? { register: found.register, depth: 0 } : { register: this.context.register, depth };
  }

  /** V8's BuildVariableAssignment: the accumulator is stored into the variable `identifier` names. */
  private assignToVariable(identifier: Identifier, op: "init" | "assign"): void {
    const reference = this.scopes.referenceOf.get(identifier);
    const variable = this.scopes.declarationOf.get(identifier) ?? reference?.resolved;
    if (!variable) throw new NotYetSupported(identifier);
    if (variable === "global") {
      const slot = this.cachedSlot(`store:${identifier.name}`, "global-store");
      this.builder.emit("StaGlobal", this.stringConstant(identifier.name), slot);
      return;
    }
    if (op !== "init" && reference?.needsTdzCheck && !this.checked.has(variable)) {
      // The value waits in a register while the binding is read and checked.
      const value = this.builder.allocateRegister();
      this.builder.emit("Star", local(value));
      this.loadVariable(variable, identifier, true);
      this.checkForHole(variable, identifier.name);
      this.builder.emit("Ldar", local(value));
    }
    if (op !== "init" && variable.kind === "const") {
      this.builder.emit("CallRuntime", "ThrowConstAssignError", local(0), 0);
      return;
    }
    this.storeVariable(variable, identifier);
  }

  /** Stores the accumulator into the variable's storage, with no checks. */
  private storeVariable(variable: Variable, at: Node): void {
    const allocation = variable.allocation;
    switch (allocation.kind) {
      case "register":
        this.builder.emit("Star", local(allocation.index));
        return;
      case "parameter":
        this.builder.emit("Star", argument(allocation.index));
        return;
      case "context": {
        const { register, depth } = this.contextAccess(variable);
        const slot = this.slotOf(variable);
        if (register === CURRENT_CONTEXT && depth === 0) this.builder.emit("StaCurrentContextSlot", slot);
        else this.builder.emit("StaContextSlot", register, slot, depth);
        return;
      }
      default:
        throw new NotYetSupported(at);
    }
  }

  // Unary operators.

  private visitUnary(node: UnaryExpression): void {
    const b = this.builder;
    switch (node.operator) {
      case "!":
        return this.visitNot(node.argument);
      case "typeof": {
        this.visitForTypeOfValue(node.argument);
        b.emit("TypeOf", b.feedback.addSlot("binary-op"));
        this.setResultIsString();
        return;
      }
      case "void":
        this.visitForEffect(node.argument);
        b.emit("LdaUndefined");
        return;
      case "delete":
        return this.visitDelete(node);
      case "+":
      case "-":
      case "~": {
        this.visitForAccumulatorValue(node.argument);
        b.setExpressionPosition(startOf(node));
        const opcode = node.operator === "+" ? "ToNumber" : node.operator === "-" ? "Negate" : "BitwiseNot";
        b.emit(opcode, b.feedback.addSlot("binary-op"));
        return;
      }
      default:
        throw new NotYetSupported(node);
    }
  }

  /** `!operand`; in a test it only swaps the targets and what falls through. */
  private visitNot(operand: Expression): void {
    const b = this.builder;
    if (this.result.kind === "effect") {
      this.visitForEffect(operand);
    } else if (this.result.kind === "test") {
      const scope = this.result;
      [scope.thenLabels, scope.elseLabels] = [scope.elseLabels, scope.thenLabels];
      scope.fallthrough = scope.fallthrough === "then" ? "else" : scope.fallthrough === "else" ? "then" : "none";
      this.visitInSameTestScope(operand);
    } else {
      const hint = this.visitForAccumulatorValue(operand);
      b.emit(hint === "boolean" ? "LogicalNot" : "ToBooleanLogicalNot");
      this.setResultIsBoolean();
    }
  }

  /** The operand of `typeof`: an unresolved name must not throw. */
  private visitForTypeOfValue(operand: Expression): void {
    if (operand.type === "Identifier") {
      const entered = this.enter("value");
      this.loadIdentifier(operand, true);
      this.leave(entered);
    } else {
      this.visitForAccumulatorValue(operand);
    }
  }

  // Binary operators.

  private visitBinary(node: BinaryExpression): void {
    if (node.left.type === "PrivateIdentifier") throw new NotYetSupported(node);
    const operator = node.operator;
    if (operator in COMPARISON) return this.visitCompare(node);
    if (operator === "!=" || operator === "!==") {
      // V8's parser reads `a != b` as `!(a == b)`.
      const equal: BinaryExpression = { ...node, operator: operator === "!=" ? "==" : "===" };
      return this.visitNot(equal);
    }
    if (!(operator in ARITHMETIC)) throw new NotYetSupported(node);
    const chain = this.collectChain(node);
    if (chain.operands.length > 2) return this.visitNaryArithmetic(chain);
    this.visitArithmetic(node.left, node.right, operator, this.operatorAt(node.left));
  }

  private operatorAt(left: Node): number {
    return operatorPosition(this.source, endOf(left));
  }

  /** `a op b op c ...` as one operation, the way V8's parser collapses same-operator chains. */
  private collectChain(node: BinaryExpression | LogicalExpression): Chain {
    const operator = node.operator;
    const operands: Expression[] = [];
    const positions: number[] = [];
    let current: Expression = node;
    for (;;) {
      if (
        (current.type === "BinaryExpression" || current.type === "LogicalExpression") &&
        current.operator === operator &&
        operator !== "**" &&
        current.left.type !== "PrivateIdentifier" &&
        literalOf(current) === undefined
      ) {
        operands.unshift(current.right);
        positions.unshift(this.operatorAt(current.left));
        current = current.left;
      } else {
        operands.unshift(current);
        break;
      }
    }
    return { operator, operands, positions };
  }

  private smiLiteralOf(node: Expression): number | undefined {
    const literal = literalOf(node);
    return literal?.kind === "number" && isSmi(literal.value) ? literal.value : undefined;
  }

  private visitArithmetic(left: Expression, right: Expression, operator: string, position: number): void {
    const b = this.builder;
    const slot = b.feedback.addSlot("binary-op");
    const rightSmi = this.smiLiteralOf(right);
    const leftSmi = COMMUTATIVE_WITH_SMI_LEFT.has(operator) ? this.smiLiteralOf(left) : undefined;
    if (rightSmi !== undefined || leftSmi !== undefined) {
      const subexpression = rightSmi !== undefined ? left : right;
      const hint = this.visitForAccumulatorValue(subexpression);
      b.setExpressionPosition(position);
      b.emit(SMI_ARITHMETIC[operator] as Opcode, (rightSmi ?? leftSmi) as number, slot);
      if (operator === "+" && hint === "string") this.setResultIsString();
      return;
    }
    const leftHint = this.visitForAccumulatorValue(left);
    const register = b.allocateRegister();
    b.emit("Star", local(register));
    const rightHint = this.visitForAccumulatorValue(right);
    b.setExpressionPosition(position);
    b.emit(ARITHMETIC[operator] as Opcode, local(register), slot);
    if (operator === "+" && (leftHint === "string" || rightHint === "string")) this.setResultIsString();
  }

  private visitNaryArithmetic(chain: Chain): void {
    const b = this.builder;
    const operator = chain.operator;
    let hint = this.visitForAccumulatorValue(chain.operands[0] as Expression);
    for (let i = 1; i < chain.operands.length; i++) {
      const top = b.registerTop;
      const operand = chain.operands[i] as Expression;
      const position = chain.positions[i - 1] as number;
      const smi = this.smiLiteralOf(operand);
      if (smi !== undefined) {
        b.setExpressionPosition(position);
        b.emit(SMI_ARITHMETIC[operator] as Opcode, smi, b.feedback.addSlot("binary-op"));
      } else {
        const register = b.allocateRegister();
        b.emit("Star", local(register));
        const operandHint = this.visitForAccumulatorValue(operand);
        b.setExpressionPosition(position);
        b.emit(ARITHMETIC[operator] as Opcode, local(register), b.feedback.addSlot("binary-op"));
        if (operandHint === "string") hint = "string";
      }
      b.releaseRegisters(top);
    }
    if (operator === "+" && hint === "string") this.setResultIsString();
  }

  // Comparisons.

  private isUndefinedLiteral(node: Expression): boolean {
    if (node.type === "Identifier") return node.name === "undefined" && this.scopes.referenceOf.get(node)?.resolved === "global";
    return node.type === "UnaryExpression" && node.operator === "void" && literalOf(node.argument) !== undefined;
  }

  private isNullLiteral(node: Expression): boolean {
    return literalOf(node)?.kind === "null";
  }

  private visitCompare(node: BinaryExpression): void {
    if (node.left.type === "PrivateIdentifier") throw new NotYetSupported(node);
    const b = this.builder;
    const operator = node.operator;
    const position = this.operatorAt(node.left);
    const equality = operator === "==" || operator === "===";
    const left = node.left;
    const right = node.right;

    const typeofSide = equality ? this.typeofComparison(left, right) : undefined;
    if (typeofSide) {
      this.visitForTypeOfValue(typeofSide.operand);
      b.setExpressionPosition(position);
      const flag = TYPEOF_FLAGS[typeofSide.literal];
      if (flag === undefined) b.emit("LdaFalse");
      else b.emit("TestTypeOf", flag);
    } else if (equality && (this.isUndefinedLiteral(left) || this.isUndefinedLiteral(right))) {
      this.visitForAccumulatorValue(this.isUndefinedLiteral(right) ? left : right);
      b.setExpressionPosition(position);
      this.buildLiteralCompareNil(operator, "undefined");
    } else if (equality && (this.isNullLiteral(left) || this.isNullLiteral(right))) {
      this.visitForAccumulatorValue(this.isNullLiteral(right) ? left : right);
      b.setExpressionPosition(position);
      this.buildLiteralCompareNil(operator, "null");
    } else {
      const lhs = this.visitForRegisterValue(left);
      this.visitForAccumulatorValue(right);
      b.setExpressionPosition(position);
      const slot = b.feedback.addSlot(operator === "in" ? "has-keyed" : operator === "instanceof" ? "instance-of" : "compare");
      b.emit(COMPARISON[operator] as Opcode, local(lhs), slot);
    }
    this.setResultIsBoolean();
  }

  /** `typeof x == "string"` or `"string" == typeof x`. */
  private typeofComparison(left: Expression, right: Expression): { operand: Expression; literal: string } | undefined {
    const isTypeof = (e: Expression): e is UnaryExpression => e.type === "UnaryExpression" && e.operator === "typeof";
    const text = (e: Expression): string | undefined => {
      const literal = literalOf(e);
      return literal?.kind === "string" && e.type === "Literal" ? literal.value : undefined;
    };
    if (isTypeof(left) && text(right) !== undefined) return { operand: left.argument, literal: text(right) as string };
    if (isTypeof(right) && text(left) !== undefined) return { operand: right.argument, literal: text(left) as string };
    return undefined;
  }

  private buildLiteralCompareNil(operator: string, nil: "undefined" | "null"): void {
    const b = this.builder;
    const strict = operator === "===";
    if (this.result.kind === "test") {
      const scope = this.result;
      const jumpIfNil = (labels: BytecodeLabels): void => {
        if (strict) b.jump(nil === "undefined" ? "JumpIfUndefined" : "JumpIfNull", labels.new());
        else {
          b.emit("TestUndetectable");
          b.jump("JumpIfTrue", labels.new());
        }
      };
      const jumpIfNotNil = (labels: BytecodeLabels): void => {
        if (strict) b.jump(nil === "undefined" ? "JumpIfNotUndefined" : "JumpIfNotNull", labels.new());
        else {
          b.emit("TestUndetectable");
          b.jump("JumpIfFalse", labels.new());
        }
      };
      switch (scope.fallthrough) {
        case "then":
          jumpIfNotNil(scope.elseLabels);
          break;
        case "else":
          jumpIfNil(scope.thenLabels);
          break;
        case "none":
          jumpIfNil(scope.thenLabels);
          b.jump("Jump", scope.elseLabels.new());
          break;
      }
      scope.consumed = true;
    } else if (!strict) {
      b.emit("TestUndetectable");
    } else {
      b.emit(nil === "undefined" ? "TestUndefined" : "TestNull");
    }
  }

  // Logical operators.

  private visitLogical(node: LogicalExpression): void {
    const chain = this.collectChain(node);
    const operands = chain.operands;
    const operator = node.operator;
    const first = operands[0] as Expression;
    if (this.result.kind === "test") {
      const scope = this.result;
      if (operator === "||" && toBooleanOf(first) === true) {
        this.builder.jump("Jump", scope.thenLabels.new());
      } else if (operator === "&&" && toBooleanOf(first) === false) {
        this.builder.jump("Jump", scope.elseLabels.new());
      } else if (operator === "||" && toBooleanOf(first) === false && operands.every((e) => toBooleanOf(e) === false)) {
        this.builder.jump("Jump", scope.elseLabels.new());
      } else if (operator === "&&" && operands.every((e) => toBooleanOf(e) === true)) {
        this.builder.jump("Jump", scope.thenLabels.new());
      } else {
        this.visitLogicalTest(operator, operands);
      }
      scope.consumed = true;
      return;
    }
    const end = this.newLabels();
    // Only the first operand always runs.
    let afterFirst: Set<Variable> | undefined;
    for (let i = 0; i < operands.length - 1; i++) {
      if (this.visitLogicalSubExpression(operator, operands[i] as Expression, end)) {
        if (afterFirst) this.checked = afterFirst;
        return;
      }
      afterFirst ??= new Set(this.checked);
    }
    this.visitForAccumulatorValue(operands[operands.length - 1] as Expression);
    end.bind();
    if (afterFirst) this.checked = afterFirst;
  }

  /** One non-final operand of `||`, `&&` or `??` in a value context; true when it settles the result. */
  private visitLogicalSubExpression(operator: string, operand: Expression, end: BytecodeLabels): boolean {
    const b = this.builder;
    if (operator === "||") {
      if (toBooleanOf(operand) === true) {
        this.visitForAccumulatorValue(operand);
        end.bind();
        return true;
      }
      if (toBooleanOf(operand) !== false) {
        const hint = this.visitForAccumulatorValue(operand);
        this.jumpIfTrue(hint, end);
      }
    } else if (operator === "&&") {
      if (toBooleanOf(operand) === false) {
        this.visitForAccumulatorValue(operand);
        end.bind();
        return true;
      }
      if (toBooleanOf(operand) !== true) {
        const hint = this.visitForAccumulatorValue(operand);
        this.jumpIfFalse(hint, end);
      }
    } else {
      const literal = literalOf(operand);
      if (literal && literal.kind !== "null") {
        this.visitForAccumulatorValue(operand);
        end.bind();
        return true;
      }
      if (!literal && !this.isUndefinedLiteral(operand)) {
        this.visitForAccumulatorValue(operand);
        const isNullish = this.newLabels();
        b.jump("JumpIfUndefinedOrNull", isNullish.new());
        b.jump("Jump", end.new());
        isNullish.bind();
      }
    }
    return false;
  }

  /** `a || b || c` and friends in a test: each operand but the last tests and falls through to the next. */
  private visitLogicalTest(operator: string, operands: readonly Expression[]): void {
    const scope = this.result;
    let afterFirst: Set<Variable> | undefined;
    for (let i = 0; i < operands.length - 1; i++) {
      const next = this.newLabels();
      const operand = operands[i] as Expression;
      if (operator === "||") this.visitForTest(operand, scope.thenLabels, next, "else");
      else if (operator === "&&") this.visitForTest(operand, next, scope.elseLabels, "then");
      else this.visitForNullishTest(operand, scope.thenLabels, next, scope.elseLabels);
      next.bind();
      afterFirst ??= new Set(this.checked);
    }
    this.visitInSameTestScope(operands[operands.length - 1] as Expression);
    if (afterFirst) this.checked = afterFirst;
  }

  private visitForNullishTest(operand: Expression, thenLabels: BytecodeLabels, next: BytecodeLabels, elseLabels: BytecodeLabels): void {
    const hint = this.visitForAccumulatorValue(operand);
    if (hint !== "boolean") this.builder.jump("JumpIfUndefinedOrNull", next.new());
    const scope = new ResultScope("test");
    scope.thenLabels = thenLabels;
    scope.elseLabels = elseLabels;
    scope.fallthrough = "none";
    scope.typeHint = hint;
    this.buildTest(scope);
  }

  private visitConditional(node: ConditionalExpression): void {
    const thenLabels = this.newLabels();
    const elseLabels = this.newLabels();
    const endLabels = this.newLabels();
    const condition = toBooleanOf(node.test);
    if (condition === true) {
      thenLabels.bind();
      this.visitForAccumulatorValue(node.consequent);
    } else if (condition === false) {
      elseLabels.bind();
      this.visitForAccumulatorValue(node.alternate);
    } else {
      this.visitForTest(node.test, thenLabels, elseLabels, "then");
      this.mergeBranches(
        () => {
          thenLabels.bind();
          this.visitForAccumulatorValue(node.consequent);
          this.builder.jump("Jump", endLabels.new());
        },
        () => {
          elseLabels.bind();
          this.visitForAccumulatorValue(node.alternate);
        },
      );
    }
    if (!elseLabels.bound) elseLabels.bind();
    endLabels.bind();
  }

  private visitSequence(expressions: readonly Expression[]): void {
    for (let i = 0; i < expressions.length; i++) {
      const expression = expressions[i] as Expression;
      // Each operand after the first starts a new step for the debugger.
      if (i > 0) this.builder.setStatementPosition(this.positionOf(expression));
      if (i < expressions.length - 1) this.visitForEffect(expression);
      else this.visitExpression(expression);
    }
  }

  /** V8's `Expression::position()`: where an operator-like node sits, else where it starts. */
  private positionOf(node: Expression): number {
    switch (node.type) {
      case "BinaryExpression":
      case "LogicalExpression": {
        if (literalOf(node)) return startOf(node);
        // A collapsed same-operator chain sits where its first operand does.
        const collapsible = node.type === "LogicalExpression" || node.operator in ARITHMETIC;
        const chain = collapsible ? this.collectChain(node) : undefined;
        const first = chain?.operands[0];
        return chain && first && chain.operands.length > 2 ? this.positionOf(first) : this.operatorAt(node.left);
      }
      case "AssignmentExpression":
        return this.operatorAt(node.left);
      case "UpdateExpression":
        return node.prefix ? startOf(node.argument) : operatorPosition(this.source, endOf(node.argument));
      // A conditional sits where its condition starts, inside any parentheses around the whole.
      case "ConditionalExpression":
        return node.range?.[0] ?? 0;
      case "CallExpression":
        return node.callee.type === "Super" ? startOf(node) : this.callPosition(node);
      case "MemberExpression":
        return this.memberPosition(node);
      default:
        return startOf(node);
    }
  }

  // Assignment.

  /** V8's PrepareAssignmentLhs for a property: the object (and for `o[k]` the key) wait in registers. */
  private prepareMember(target: MemberExpression, keyBeforeVisit = false): Reference {
    if (target.optional || target.object.type === "Super") throw new NotYetSupported(target);
    const object = this.visitForRegisterValue(target.object);
    const name = this.namedKeyOf(target);
    if (name !== undefined) return { kind: "named", objectExpression: target.object, object, name };
    if (keyBeforeVisit) {
      // `o[k]++`: the key's register is taken before the key is evaluated.
      const key = this.builder.allocateRegister();
      this.visitForAccumulatorValue(target.property as Expression);
      this.builder.emit("Star", local(key));
      return { kind: "keyed", object, key };
    }
    return { kind: "keyed", object, key: this.visitForRegisterValue(target.property as Expression) };
  }

  /** The current value of the target, in the accumulator (V8's BuildLoadCurrentValueInAccumulator). */
  private loadReference(reference: Reference, target: Identifier | MemberExpression): void {
    const b = this.builder;
    switch (reference.kind) {
      case "variable":
        this.loadIdentifier(target as Identifier, false);
        return;
      case "named":
        b.emit("GetNamedProperty", local(reference.object), this.stringConstant(reference.name), this.cachedPropertySlot("load", reference.objectExpression, reference.name));
        return;
      case "keyed":
        b.emit("Ldar", local(reference.key));
        b.emit("GetKeyedProperty", local(reference.object), b.feedback.addSlot("load"));
        return;
    }
  }

  /** Stores the accumulator into the target; a property store keeps the value in the accumulator for whoever reads the result. */
  private storeReference(reference: Reference, target: Identifier | MemberExpression, keepValue: boolean): void {
    const b = this.builder;
    if (reference.kind === "variable") {
      this.assignToVariable(target as Identifier, "assign");
      return;
    }
    let value = -1;
    if (keepValue) {
      value = b.allocateRegister();
      b.emit("Star", local(value));
    }
    if (reference.kind === "named") {
      b.emit("SetNamedProperty", local(reference.object), this.stringConstant(reference.name), this.cachedPropertySlot("store", reference.objectExpression, reference.name));
    } else {
      b.emit("SetKeyedProperty", local(reference.object), local(reference.key), b.feedback.addSlot("store"));
    }
    if (keepValue) b.emit("Ldar", local(value));
  }

  private visitAssignment(node: AssignmentExpression): void {
    const target = node.left;
    if (target.type === "MemberExpression") return this.visitMemberAssignment(node, target);
    if (target.type !== "Identifier") throw new NotYetSupported(target);
    const b = this.builder;
    const position = this.operatorAt(target);
    const operator = node.operator;
    if (operator === "=") {
      this.visitForAccumulatorValue(node.right, target.name);
      b.setExpressionPosition(position);
      this.assignToVariable(target, "assign");
      return;
    }
    if (operator === "&&=" || operator === "||=" || operator === "??=") {
      const end = this.newLabels();
      // V8 reserves the compound assignment's binary-op slot even though no instruction uses it.
      b.feedback.addSlot("binary-op");
      this.loadIdentifier(target, false);
      if (operator === "||=") this.jumpIfTrue("any", end);
      else if (operator === "&&=") this.jumpIfFalse("any", end);
      else {
        const isNullish = this.newLabels();
        b.jump("JumpIfUndefinedOrNull", isNullish.new());
        b.jump("Jump", end.new());
        isNullish.bind();
      }
      this.visitForAccumulatorValue(node.right);
      b.setExpressionPosition(position);
      this.assignToVariable(target, "assign");
      end.bind();
      return;
    }
    const binary = operator.slice(0, -1);
    if (!(binary in ARITHMETIC)) throw new NotYetSupported(node);
    this.loadIdentifier(target, false);
    const slot = b.feedback.addSlot("binary-op");
    const smi = this.smiLiteralOf(node.right);
    if (smi !== undefined) {
      b.emit(SMI_ARITHMETIC[binary] as Opcode, smi, slot);
    } else {
      const old = b.allocateRegister();
      b.emit("Star", local(old));
      this.visitForAccumulatorValue(node.right);
      b.emit(ARITHMETIC[binary] as Opcode, local(old), slot);
    }
    b.setExpressionPosition(position);
    this.assignToVariable(target, "assign");
  }

  /** `o.a = v`, `o[k] = v` and their compound forms (logical assignment to a property is not compiled yet). */
  private visitMemberAssignment(node: AssignmentExpression, target: MemberExpression): void {
    const b = this.builder;
    const operator = node.operator;
    const position = this.operatorAt(target);
    const keepValue = this.result.kind !== "effect";
    if (operator === "=") {
      const reference = this.prepareMember(target);
      this.visitForAccumulatorValue(node.right);
      b.setExpressionPosition(position);
      this.storeReference(reference, target, keepValue);
      return;
    }
    const binary = operator.slice(0, -1);
    if (!(binary in ARITHMETIC) || operator === "&&=" || operator === "||=" || operator === "??=") throw new NotYetSupported(node);
    const reference = this.prepareMember(target);
    this.loadReference(reference, target);
    const slot = b.feedback.addSlot("binary-op");
    const smi = this.smiLiteralOf(node.right);
    if (smi !== undefined) {
      b.emit(SMI_ARITHMETIC[binary] as Opcode, smi, slot);
    } else {
      const old = b.allocateRegister();
      b.emit("Star", local(old));
      this.visitForAccumulatorValue(node.right);
      b.emit(ARITHMETIC[binary] as Opcode, local(old), slot);
    }
    b.setExpressionPosition(position);
    this.storeReference(reference, target, keepValue);
  }

  private visitMemberUpdate(node: UpdateExpression, target: MemberExpression): void {
    const b = this.builder;
    const postfixValue = !node.prefix && this.result.kind !== "effect";
    const reference = this.prepareMember(target, true);
    this.loadReference(reference, target);
    const slot = b.feedback.addSlot("binary-op");
    let old = -1;
    if (postfixValue) {
      old = b.allocateRegister();
      b.emit("ToNumeric", slot);
      b.emit("Star", local(old));
    }
    b.emit(node.operator === "++" ? "Inc" : "Dec", slot);
    b.setExpressionPosition(this.updatePosition(node));
    this.storeReference(reference, target, this.result.kind !== "effect");
    if (postfixValue) b.emit("Ldar", local(old));
  }

  /** V8's CountOperation position: the operator of `x++`, the last token of the operand of `++x`. */
  private updatePosition(node: UpdateExpression): number {
    const target = node.argument;
    if (!node.prefix) return operatorPosition(this.source, endOf(target));
    if (target.type === "MemberExpression") return target.computed ? operatorPosition(this.source, endOf(target.property)) : startOf(target.property);
    return startOf(target);
  }

  private visitUpdate(node: UpdateExpression): void {
    const target = node.argument;
    if (target.type === "MemberExpression") return this.visitMemberUpdate(node, target);
    if (target.type !== "Identifier") throw new NotYetSupported(target);
    const b = this.builder;
    const postfixValue = !node.prefix && this.result.kind !== "effect";
    this.loadIdentifier(target, false);
    const slot = b.feedback.addSlot("binary-op");
    let old = -1;
    if (postfixValue) {
      old = b.allocateRegister();
      b.emit("ToNumeric", slot);
      b.emit("Star", local(old));
    }
    b.emit(node.operator === "++" ? "Inc" : "Dec", slot);
    b.setExpressionPosition(node.prefix ? startOf(node) : operatorPosition(this.source, endOf(target)));
    this.assignToVariable(target, "assign");
    if (postfixValue) b.emit("Ldar", local(old));
  }

  // Template literals.

  private visitTemplateLiteral(node: TemplateLiteral): void {
    const b = this.builder;
    const parts = node.quasis.map((quasi) => quasi.value.cooked ?? "");
    const slot = b.feedback.addSlot("binary-op");
    const lastPart = b.allocateRegister();
    let lastPartValid = false;
    b.setExpressionPosition(startOf(node));
    for (let i = 0; i < node.expressions.length; i++) {
      if (i !== 0) {
        b.emit("Star", local(lastPart));
        lastPartValid = true;
      }
      const part = parts[i] as string;
      if (part !== "") {
        b.emit("LdaConstant", this.stringConstant(part));
        if (lastPartValid) b.emit("Add", local(lastPart), slot);
        b.emit("Star", local(lastPart));
        lastPartValid = true;
      }
      const hint = this.visitForAccumulatorValue(node.expressions[i] as Expression);
      if (hint !== "string") b.emit("ToString");
      if (lastPartValid) b.emit("Add", local(lastPart), slot);
      lastPartValid = false;
    }
    const last = parts[parts.length - 1] as string;
    if (last !== "") {
      b.emit("Star", local(lastPart));
      b.emit("LdaConstant", this.stringConstant(last));
      b.emit("Add", local(lastPart), slot);
    }
  }
}

/** Whether V8 reads a string key as an array index (a canonical integer below 2**32 - 1), which makes the access keyed. */
function isArrayIndex(text: string): boolean {
  return /^(0|[1-9]\d*)$/.test(text) && Number(text) < 4294967295;
}
