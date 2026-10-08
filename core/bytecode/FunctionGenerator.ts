import type {
  AssignmentExpression,
  BinaryExpression,
  Expression,
  Identifier,
  LogicalExpression,
  Node,
  Pattern,
  Statement,
  TemplateLiteral,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
} from "estree";
import type { ReferenceInfo, ScopeTree, Variable } from "@/core/frontend/scope/Scope";
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

/** `a * 2` and `2 * a` are the same to the generator; `+` is not commutative for it (strings). */
const COMMUTATIVE_WITH_SMI_LEFT: ReadonlySet<string> = new Set(["|", "&", "^", "*"]);

type Lhs = { readonly kind: "variable"; readonly identifier: Identifier };

export type FunctionGeneratorOptions = {
  readonly source: string;
  readonly scopes: ScopeTree;
  readonly parameterCount: number;
  readonly localCount: number;
};

export class FunctionGenerator {
  readonly builder: BytecodeArrayBuilder;
  private readonly source: string;
  private readonly scopes: ScopeTree;
  private result: ResultScope = new ResultScope("effect");
  private readonly slotCache = new Map<string, number>();

  constructor(options: FunctionGeneratorOptions) {
    this.source = options.source;
    this.scopes = options.scopes;
    this.builder = new BytecodeArrayBuilder({
      parameterCount: options.parameterCount,
      localCount: options.localCount,
      optimizeRegisters: true,
    });
  }

  // Statements.

  generateBody(statements: readonly Statement[], returnPosition: number): void {
    this.visitStatements(statements);
    if (!this.builder.remainderOfBlockIsDead) {
      this.builder.emit("LdaUndefined");
      this.builder.setStatementPosition(returnPosition);
      this.builder.emit("Return");
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
    const b = this.builder;
    switch (node.type) {
      case "EmptyStatement":
        return;
      case "ExpressionStatement":
        b.setStatementPosition(startOf(node));
        this.visitForEffect(node.expression);
        return;
      case "VariableDeclaration":
        this.visitVariableDeclaration(node);
        return;
      default:
        throw new NotYetSupported(node);
    }
  }

  private visitVariableDeclaration(node: VariableDeclaration): void {
    for (const declarator of node.declarations) {
      const target = declarator.id;
      if (target.type !== "Identifier") throw new NotYetSupported(target);
      let init: Expression | null | undefined = declarator.init;
      let position: number;
      if (init) {
        position = startOf(init);
      } else if (node.kind === "let") {
        // `let x;` initializes x to undefined, at the position of the name.
        position = startOf(target);
      } else {
        continue;
      }
      this.builder.setStatementPosition(position);
      const top = this.builder.registerTop;
      const scope = this.enter("effect");
      if (init) this.visitForAccumulatorValue(init);
      else this.builder.emit("LdaUndefined");
      init = undefined;
      this.builder.setExpressionPosition(position);
      this.assignToVariable({ kind: "variable", identifier: target }, "init");
      this.leave(scope);
      this.builder.releaseRegisters(top);
    }
  }

  // Result scopes.

  private enter(kind: ResultKind): { readonly previous: ResultScope; readonly scope: ResultScope; readonly top: number } {
    const previous = this.result;
    const scope = new ResultScope(kind);
    this.result = scope;
    return { previous, scope, top: this.builder.registerTop };
  }

  private leave(entered: { readonly previous: ResultScope; readonly top: number }): void {
    this.result = entered.previous;
    this.builder.releaseRegisters(entered.top);
  }

  private visitForEffect(expression: Expression): void {
    const entered = this.enter("effect");
    this.visitExpression(expression);
    this.leave(entered);
  }

  private visitForAccumulatorValue(expression: Expression): TypeHint {
    const entered = this.enter("value");
    this.visitExpression(expression);
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

  private setResultIsBoolean(): void {
    this.result.typeHint = "boolean";
  }

  private setResultIsString(): void {
    this.result.typeHint = "string";
  }

  // Expressions.

  private visitExpression(node: Expression): void {
    // V8's parser has already folded literals by the time the generator runs.
    const literal = node.type === "Literal" ? undefined : literalOf(node);
    if (literal) return this.visitLiteralValue(literal);
    switch (node.type) {
      case "Literal": {
        const value = literalOf(node);
        if (!value) throw new NotYetSupported(node);
        return this.visitLiteralValue(value);
      }
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
      default:
        throw new NotYetSupported(node);
    }
  }

  private visitLiteralValue(literal: LiteralValue): void {
    if (this.result.kind === "effect") return;
    const b = this.builder;
    switch (literal.kind) {
      case "number":
        this.loadNumber(literal.value);
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

  private loadNumber(value: number): void {
    const b = this.builder;
    if (isSmi(value)) {
      if (value === 0) b.emit("LdaZero");
      else b.emit("LdaSmi", value);
    } else {
      b.emit("LdaConstant", b.constantPool.add({ kind: "number", value }));
    }
  }

  private stringConstant(value: string, folded = false): number {
    return this.builder.constantPool.add({ kind: "string", value, folded });
  }

  // Variables.

  private referenceOf(identifier: Identifier): ReferenceInfo {
    const reference = this.scopes.referenceOf.get(identifier);
    if (!reference) throw new NotYetSupported(identifier);
    return reference;
  }

  private variableOf(identifier: Identifier): Variable | "global" {
    const declared = this.scopes.declarationOf.get(identifier);
    if (declared) return declared;
    return this.referenceOf(identifier).resolved;
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

  /** V8's BuildVariableAssignment: the accumulator is stored into the variable. */
  private assignToVariable(lhs: Lhs, op: "init" | "assign"): void {
    const reference = this.scopes.referenceOf.get(lhs.identifier);
    const variable = this.variableOf(lhs.identifier);
    if (variable === "global") {
      const slot = this.cachedSlot(`store:${lhs.identifier.name}`, "global-store");
      this.builder.emit("StaGlobal", this.stringConstant(lhs.identifier.name), slot);
      return;
    }
    if (reference?.needsTdzCheck) throw new NotYetSupported(lhs.identifier);
    if (variable.kind === "const" && op !== "init") throw new NotYetSupported(lhs.identifier);
    const allocation = variable.allocation;
    switch (allocation.kind) {
      case "register":
        this.builder.emit("Star", local(allocation.index));
        return;
      case "parameter":
        this.builder.emit("Star", argument(allocation.index));
        return;
      default:
        throw new NotYetSupported(lhs.identifier);
    }
  }

  // Operators.

  private visitUnary(node: UnaryExpression): void {
    const b = this.builder;
    const position = this.unaryPosition(node);
    switch (node.operator) {
      case "!": {
        if (this.result.kind === "effect") {
          this.visitForEffect(node.argument);
        } else if (this.result.kind === "test") {
          const scope = this.result;
          [scope.thenLabels, scope.elseLabels] = [scope.elseLabels, scope.thenLabels];
          scope.fallthrough = scope.fallthrough === "then" ? "else" : scope.fallthrough === "else" ? "then" : "none";
          this.visitInSameTestScope(node.argument);
        } else {
          const hint = this.visitForAccumulatorValue(node.argument);
          b.emit(hint === "boolean" ? "LogicalNot" : "ToBooleanLogicalNot");
          this.setResultIsBoolean();
        }
        return;
      }
      case "typeof": {
        if (node.argument.type === "Identifier") this.loadIdentifierForTypeof(node.argument);
        else this.visitForAccumulatorValue(node.argument);
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
        b.setExpressionPosition(position);
        const opcode = node.operator === "+" ? "ToNumber" : node.operator === "-" ? "Negate" : "BitwiseNot";
        b.emit(opcode, b.feedback.addSlot("binary-op"));
        return;
      }
      default:
        throw new NotYetSupported(node);
    }
  }

  private loadIdentifierForTypeof(identifier: Identifier): void {
    const entered = this.enter("value");
    this.loadIdentifier(identifier, true);
    this.leave(entered);
  }

  private unaryPosition(node: UnaryExpression): number {
    return startOf(node);
  }

  private isSmiLiteral(node: Expression): number | undefined {
    const literal = literalOf(node);
    return literal?.kind === "number" && isSmi(literal.value) ? literal.value : undefined;
  }

  private visitBinary(node: BinaryExpression): void {
    if (node.left.type === "PrivateIdentifier") throw new NotYetSupported(node);
    const operator = node.operator;
    if (operator in COMPARISON) return this.visitCompare(node);
    if (operator === "!=" || operator === "!==") return this.visitNegatedCompare(node);
    if (!(operator in ARITHMETIC)) throw new NotYetSupported(node);
    const chain = this.collectChain(node, node.operator);
    if (chain.operands.length > 2) return this.visitNaryArithmetic(chain);
    this.visitArithmetic(node, node.left, node.right, operator, this.operatorAt(node.left));
  }

  private operatorAt(left: Node): number {
    return operatorPosition(this.source, endOf(left));
  }

  /** `a op b op c ...` as one operation, the way V8's parser collapses same-operator chains. */
  private collectChain(
    node: BinaryExpression | LogicalExpression,
    operator: string,
  ): { readonly operands: Expression[]; readonly positions: number[] } {
    const operands: Expression[] = [];
    const positions: number[] = [];
    let current: Expression = node;
    for (;;) {
      if (
        (current.type === "BinaryExpression" || current.type === "LogicalExpression") &&
        current.operator === operator &&
        operator !== "**" &&
        literalOf(current) === undefined &&
        current.left.type !== "PrivateIdentifier"
      ) {
        operands.unshift(current.right);
        positions.unshift(this.operatorAt(current.left));
        current = current.left;
      } else {
        operands.unshift(current);
        break;
      }
    }
    return { operands, positions };
  }

  private visitArithmetic(node: BinaryExpression, left: Expression, right: Expression, operator: string, position: number): void {
    const b = this.builder;
    const slot = b.feedback.addSlot("binary-op");
    const rightSmi = this.isSmiLiteral(right);
    const leftSmi = COMMUTATIVE_WITH_SMI_LEFT.has(operator) ? this.isSmiLiteral(left) : undefined;
    if (rightSmi !== undefined || leftSmi !== undefined) {
      const subexpression = rightSmi !== undefined ? left : right;
      const literal = (rightSmi ?? leftSmi) as number;
      const hint = this.visitForAccumulatorValue(subexpression);
      b.setExpressionPosition(position);
      b.emit(SMI_ARITHMETIC[operator] as Opcode, literal, slot);
      if (operator === "+" && hint === "string") this.setResultIsString();
      return;
    }
    const entered = this.enter("value");
    void entered;
    this.leave(entered);
    const leftHint = this.visitForAccumulatorValue(left);
    const register = b.allocateRegister();
    b.emit("Star", local(register));
    const rightHint = this.visitForAccumulatorValue(right);
    b.setExpressionPosition(position);
    b.emit(ARITHMETIC[operator] as Opcode, local(register), slot);
    if (operator === "+" && (leftHint === "string" || rightHint === "string")) this.setResultIsString();
    void node;
  }

  private visitNaryArithmetic(chain: { readonly operands: Expression[]; readonly positions: number[] }, operator?: string): void {
    const b = this.builder;
    const op = operator ?? this.chainOperator(chain);
    const first = chain.operands[0] as Expression;
    let hint = this.visitForAccumulatorValue(first);
    for (let i = 1; i < chain.operands.length; i++) {
      const top = b.registerTop;
      const operand = chain.operands[i] as Expression;
      const position = chain.positions[i - 1] as number;
      const smi = this.isSmiLiteral(operand);
      if (smi !== undefined) {
        b.setExpressionPosition(position);
        b.emit(SMI_ARITHMETIC[op] as Opcode, smi, b.feedback.addSlot("binary-op"));
      } else {
        const register = b.allocateRegister();
        b.emit("Star", local(register));
        const operandHint = this.visitForAccumulatorValue(operand);
        b.setExpressionPosition(position);
        b.emit(ARITHMETIC[op] as Opcode, local(register), b.feedback.addSlot("binary-op"));
        if (operandHint === "string") hint = "string";
      }
      b.releaseRegisters(top);
    }
    if (op === "+" && hint === "string") this.setResultIsString();
  }

  private chainOperator(chain: { readonly operands: Expression[] }): string {
    const last = chain.operands[1];
    void last;
    return this.currentChainOperator;
  }

  private currentChainOperator = "+";

  private visitCompare(node: BinaryExpression): void {
    throw new NotYetSupported(node);
  }

  private visitNegatedCompare(node: BinaryExpression): void {
    throw new NotYetSupported(node);
  }

  private visitLogical(node: LogicalExpression): void {
    throw new NotYetSupported(node);
  }

  private visitConditional(node: Expression): void {
    throw new NotYetSupported(node);
  }

  private visitSequence(expressions: readonly Expression[]): void {
    throw new NotYetSupported(expressions[0] as Node);
  }

  private visitAssignment(node: AssignmentExpression): void {
    throw new NotYetSupported(node);
  }

  private visitUpdate(node: UpdateExpression): void {
    throw new NotYetSupported(node);
  }

  private visitTemplateLiteral(node: TemplateLiteral): void {
    throw new NotYetSupported(node);
  }

  protected newLabels(): BytecodeLabels {
    return new BytecodeLabels(this.builder);
  }

  protected unused(_pattern: Pattern, _label: Label): void {}
}
