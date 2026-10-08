import type {
  ArrowFunctionExpression,
  AssignmentExpression,
  BinaryExpression,
  ConditionalExpression,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  LogicalExpression,
  Node,
  ReturnStatement,
  SimpleCallExpression,
  Statement,
  TemplateLiteral,
  ThrowStatement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  WhileStatement,
} from "estree";
import type { ReferenceInfo, Scope, ScopeTree, Variable } from "@/core/frontend/scope/Scope";
import type { FunctionId } from "@/core/shared/ids";
import { BytecodeArrayBuilder, type Label } from "./BytecodeArrayBuilder";
import { BytecodeLabels } from "./BytecodeLabels";
import { type Opcode, THIS, argument, local } from "./bytecodes";
import { type LiteralValue, isSmi, literalOf, toBooleanOf } from "./literals";
import { endOf, operatorPosition, startOf } from "./sourceText";

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
};

/** `BytecodeArray::kMaxOsrUrgency - 1`: the deepest loop level a `JumpLoop` reports. */
const MAX_OSR_DEPTH = 5;

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
  /** Compiles `node` to bytecode of its own and returns its id. `name` is the SharedFunctionInfo name (inferred or own). */
  compile(node: FunctionLiteral, name: string): FunctionId;
}

/** `CreateClosureFlags::FastNewClosureBit`: set when the closure is created directly in a function scope. */
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
  /** The function declarations already created at the top of the function. */
  private readonly hoisted = new Set<Node>();
  private result: ResultScope = new ResultScope("effect");
  private readonly slotCache = new Map<string, number>();
  private readonly loops: Loop[] = [];

  constructor(options: FunctionGeneratorOptions) {
    this.source = options.source;
    this.scopes = options.scopes;
    this.functions = options.functions;
    this.currentScope = options.scope;
    this.builder = new BytecodeArrayBuilder({
      parameterCount: options.parameterCount,
      localCount: options.localCount,
      optimizeRegisters: true,
    });
  }

  // Statements.

  /** A function literal's body: its parameters need no code yet, so it is the declarations, the statements and the final return. */
  generateFunction(node: FunctionLiteral): void {
    const entry = this.functionStart(node);
    if (node.body.type === "BlockStatement") {
      this.generateBody(node.body.body, endOf(node.body) - 1, entry);
      return;
    }
    // An arrow's expression body is `return <expression>`, positioned at the expression.
    const b = this.builder;
    b.setExpressionPosition(entry);
    const expression = node.body;
    b.setStatementPosition(this.positionOf(expression));
    this.visitForAccumulatorValue(expression);
    b.setStatementPosition(endOf(expression));
    b.emit("Return");
  }

  /** V8's `FunctionLiteral::start_position()`: the `(` of the parameters, or the start of an arrow. */
  private functionStart(node: FunctionLiteral): number {
    if (node.type === "ArrowFunctionExpression") return startOf(node);
    return operatorPosition(this.source, node.id ? endOf(node.id) : (node.range?.[0] ?? 0) + "function".length);
  }

  generateBody(statements: readonly Statement[], returnPosition: number, entryPosition = 0): void {
    this.builder.setExpressionPosition(entryPosition);
    this.createHoistedFunctions(statements);
    this.visitStatements(statements);
    if (!this.builder.remainderOfBlockIsDead) {
      this.builder.emit("LdaUndefined");
      this.builder.setStatementPosition(returnPosition);
      this.builder.emit("Return");
    }
  }

  /** V8's VisitDeclarations: every function declaration of the body is created before any statement runs. */
  private createHoistedFunctions(statements: readonly Statement[]): void {
    for (const statement of statements) {
      if (statement.type !== "FunctionDeclaration") continue;
      this.hoisted.add(statement);
      this.buildClosure(statement, statement.id.name);
      this.assignToVariable(statement.id, "init");
    }
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
        this.visitStatements(node.body);
        return;
      case "IfStatement":
        return this.visitIf(node);
      case "WhileStatement":
        return this.visitWhile(node);
      case "ForStatement":
        return this.visitFor(node);
      case "BreakStatement":
        this.builder.setStatementPosition(startOf(node));
        this.builder.jump("Jump", this.innermostLoop().breakLabels.new());
        return;
      case "ContinueStatement":
        this.builder.setStatementPosition(startOf(node));
        this.builder.jump("Jump", this.innermostLoop().continueLabels.new());
        return;
      case "ReturnStatement":
        return this.visitReturn(node);
      case "ThrowStatement":
        return this.visitThrow(node);
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
      thenLabels.bind();
      this.visitStatement(node.consequent);
      if (node.alternate) {
        b.jump("Jump", endLabels.new());
        elseLabels.bind();
        this.visitStatement(node.alternate);
      }
    }
    if (!elseLabels.bound) elseLabels.bind();
    endLabels.bind();
  }

  private visitReturn(node: ReturnStatement): void {
    const b = this.builder;
    b.setStatementPosition(startOf(node));
    if (node.argument) this.visitForAccumulatorValue(node.argument);
    else b.emit("LdaUndefined");
    b.setStatementPosition(endOf(node));
    b.emit("Return");
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
    const loop: Loop = { header: this.builder.newLabel(), continueLabels: this.newLabels(), backEdge: this.newLabels(), breakLabels: this.newLabels() };
    this.loops.push(loop);
    return loop;
  }

  private endLoop(loop: Loop): void {
    this.loops.pop();
    loop.breakLabels.bind();
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
      this.visitIterationBody(node.body, loop);
      this.jumpToHeader(loop, startOf(node));
    }
    this.endLoop(loop);
  }

  private visitFor(node: ForStatement): void {
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
      this.visitIterationBody(node.body, loop);
      if (node.update) {
        this.builder.setStatementPosition(this.positionOf(node.update));
        this.visitForEffect(node.update);
      }
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
  private visitForAccumulatorValue(expression: Expression, inferredName = ""): TypeHint {
    const entered = this.enter("value");
    this.visitExpression(expression, inferredName);
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

  private visitExpression(node: Expression, inferredName = ""): void {
    // V8's parser has already folded literals by the time the generator runs.
    const literal = literalOf(node);
    if (literal) return this.visitLiteralValue(literal);
    switch (node.type) {
      case "Identifier":
        this.builder.setExpressionPosition(startOf(node));
        return this.loadIdentifier(node, false);
      case "ThisExpression":
        this.builder.emit("Ldar", THIS);
        return;
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
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        this.buildClosure(node, node.type === "FunctionExpression" && node.id ? node.id.name : inferredName);
        return;
      case "CallExpression":
        return this.visitCall(node);
      default:
        throw new NotYetSupported(node);
    }
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
  private buildClosure(node: FunctionLiteral, name: string): void {
    const b = this.builder;
    const id = this.functions.compile(node, name);
    this.children.push(id);
    const index = b.constantPool.add({ kind: "sfi", name, functionId: id });
    const flags = this.currentScope.kind === "function" ? FAST_NEW_CLOSURE : 0;
    b.emit("CreateClosure", index, b.feedback.addClosureCell(), flags);
  }

  /** V8's call position: the callee for a plain name, else the `(`. */
  private callPosition(node: SimpleCallExpression): number {
    const callee = node.callee;
    if (callee.type === "Identifier") return startOf(callee);
    return operatorPosition(this.source, endOf(callee));
  }

  /** A call whose receiver is `undefined`: the callee is a name or any other expression, not a property. */
  private visitCall(node: SimpleCallExpression): void {
    const callee = node.callee;
    if (callee.type === "Super" || callee.type === "MemberExpression" || node.optional) throw new NotYetSupported(node);
    const b = this.builder;
    const top = b.registerTop;
    const calleeRegister = b.allocateRegister();
    this.visitForAccumulatorValue(callee);
    b.emit("Star", local(calleeRegister));
    const args: number[] = [];
    for (const argument of node.arguments) {
      if (argument.type === "SpreadElement") throw new NotYetSupported(argument);
      this.visitForAccumulatorValue(argument);
      const register = b.allocateRegister();
      b.emit("Star", local(register));
      args.push(register);
    }
    const slot = b.feedback.addSlot("call");
    b.setExpressionPosition(this.callPosition(node));
    const receiver = local(calleeRegister);
    const [first, second] = args.map(local);
    if (args.length === 0) b.emit("CallUndefinedReceiver0", receiver, slot);
    else if (args.length === 1) b.emit("CallUndefinedReceiver1", receiver, first as number, slot);
    else if (args.length === 2) b.emit("CallUndefinedReceiver2", receiver, first as number, second as number, slot);
    else b.emit("CallUndefinedReceiver", receiver, first as number, args.length, slot);
    b.releaseRegisters(top);
  }

  // Variables.

  private referenceOf(identifier: Identifier): ReferenceInfo {
    const reference = this.scopes.referenceOf.get(identifier);
    if (!reference) throw new NotYetSupported(identifier);
    return reference;
  }

  private cachedSlot(key: string, kind: "global-load" | "global-store"): number {
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
    if (reference.needsTdzCheck) throw new NotYetSupported(identifier);
    this.loadVariable(variable, identifier);
  }

  private loadVariable(variable: Variable, at: Node): void {
    const allocation = variable.allocation;
    switch (allocation.kind) {
      case "register":
        this.builder.emit("Ldar", local(allocation.index));
        return;
      case "parameter":
        this.builder.emit("Ldar", argument(allocation.index));
        return;
      default:
        throw new NotYetSupported(at);
    }
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
    if (reference?.needsTdzCheck) throw new NotYetSupported(identifier);
    if (variable.kind === "const" && op !== "init") throw new NotYetSupported(identifier);
    const allocation = variable.allocation;
    switch (allocation.kind) {
      case "register":
        this.builder.emit("Star", local(allocation.index));
        return;
      case "parameter":
        this.builder.emit("Star", argument(allocation.index));
        return;
      default:
        throw new NotYetSupported(identifier);
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
    for (let i = 0; i < operands.length - 1; i++) {
      if (this.visitLogicalSubExpression(operator, operands[i] as Expression, end)) return;
    }
    this.visitForAccumulatorValue(operands[operands.length - 1] as Expression);
    end.bind();
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
    for (let i = 0; i < operands.length - 1; i++) {
      const next = this.newLabels();
      const operand = operands[i] as Expression;
      if (operator === "||") this.visitForTest(operand, scope.thenLabels, next, "else");
      else if (operator === "&&") this.visitForTest(operand, next, scope.elseLabels, "then");
      else this.visitForNullishTest(operand, scope.thenLabels, next, scope.elseLabels);
      next.bind();
    }
    this.visitInSameTestScope(operands[operands.length - 1] as Expression);
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
      thenLabels.bind();
      this.visitForAccumulatorValue(node.consequent);
      this.builder.jump("Jump", endLabels.new());
      elseLabels.bind();
      this.visitForAccumulatorValue(node.alternate);
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
      case "LogicalExpression":
        return literalOf(node) ? startOf(node) : this.operatorAt(node.left);
      case "AssignmentExpression":
        return this.operatorAt(node.left);
      case "UpdateExpression":
        return node.prefix ? startOf(node.argument) : operatorPosition(this.source, endOf(node.argument));
      default:
        return startOf(node);
    }
  }

  // Assignment.

  private visitAssignment(node: AssignmentExpression): void {
    const target = node.left;
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

  private visitUpdate(node: UpdateExpression): void {
    const target = node.argument;
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
    this.setResultIsString();
  }
}
