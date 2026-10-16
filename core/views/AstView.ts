import type { Node } from "estree";
import { childNodes, rangeOf } from "@/core/frontend/ast";
import type { SourceRange } from "@/core/shared/diagnostics";
import { type CodeViewStrategy, type EmittedLine, positionsForSourceRange } from "./types";

// The AST view: the parsed tree, one node per line in source order, each tied to the bytecode that
// was generated for the source it covers.

export type AstLine = EmittedLine & {
  readonly depth: number;
  readonly range: SourceRange;
};

export type AstViewOutput = { readonly lines: readonly AstLine[] };

const MAX_LITERAL = 40;

/** The short detail that follows a node's type, or `""`. */
function label(node: Node, source: string): string {
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "Literal": {
      const text = source.slice(...(node.range ?? [0, 0]));
      return text.length > MAX_LITERAL ? `${text.slice(0, MAX_LITERAL)}…` : text;
    }
    case "VariableDeclaration":
      return node.kind;
    case "FunctionDeclaration":
    case "FunctionExpression":
      return node.id?.name ?? "";
    case "BinaryExpression":
    case "LogicalExpression":
    case "AssignmentExpression":
    case "UnaryExpression":
    case "UpdateExpression":
      return node.operator;
    default:
      return "";
  }
}

export const astView: CodeViewStrategy<AstViewOutput> = {
  id: "ast",
  emit(program, ctx) {
    const lines: AstLine[] = [];
    const visit = (node: Node, depth: number): void => {
      const range = rangeOf(node);
      const detail = label(node, ctx.source);
      lines.push({
        text: detail === "" ? node.type : `${node.type} ${detail}`,
        positions: positionsForSourceRange(program, range),
        depth,
        range,
      });
      for (const child of childNodes(node)) visit(child, depth + 1);
    };
    visit(ctx.ast, 0);
    return { lines };
  },
};
