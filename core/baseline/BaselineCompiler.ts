import type { Instruction as BytecodeInstruction } from "../bytecode/BytecodeArray";
import type { BytecodeFunction } from "../bytecode/BytecodeProgram";
import { err, ok, type Result } from "../shared/result";
import { prologue } from "./frame";
import { bytecodeArrayPointer } from "./illustrativePointers";
import { FUNCTION_ENTRY_BYTECODE_OFFSET, type BaselineCode, type BaselineInstruction, type Emit, type TemplateLabels } from "./Template";
import { TEMPLATES } from "./templates";
import { Encoder, type EncodeError, type Label } from "./x64/Encoder";
import { formatInstruction } from "./x64/syntax";

// Sparkplug's BaselineCompiler::GenerateCode: prologue, then one template per bytecode in order, assembled in two passes.

/** An assembler failure, or a template that threw (a bug in core, surfaced as data so compile() never throws). */
export type BaselineError = { readonly code: EncodeError["code"] | "E_TEMPLATE"; readonly message: string };

// The asm and binary views both need the code of the same function.
const cache = new WeakMap<BytecodeFunction, Result<BaselineCode, BaselineError[]>>();

export function compileBaseline(fn: BytecodeFunction): Result<BaselineCode, BaselineError[]> {
  const cached = cache.get(fn);
  if (cached) return cached;
  let result: Result<BaselineCode, BaselineError[]>;
  try {
    result = generate(fn);
  } catch (error) {
    result = err([{ code: "E_TEMPLATE", message: error instanceof Error ? error.message : String(error) }]);
  }
  cache.set(fn, result);
  return result;
}

function generate(fn: BytecodeFunction): Result<BaselineCode, BaselineError[]> {
  const encoder = new Encoder();
  const atLabels = new Map<number, Label>();
  const at = (offset: number): Label => {
    let label = atLabels.get(offset);
    if (!label) atLabels.set(offset, (label = encoder.label(`.L${offset}`)));
    return label;
  };

  // Parallel to the encoder's instruction order: who emitted each one.
  const owners: { bytecodeOffset: number; bytecode?: BytecodeInstruction; comment?: string }[] = [];
  const feed = (emits: readonly Emit[], bytecodeOffset: number, bytecode?: BytecodeInstruction): void => {
    for (const emit of emits) {
      if (emit.kind === "bind") encoder.bind(emit.label);
      else {
        encoder.emit(emit.instruction.mnemonic, ...emit.instruction.operands);
        owners.push({ bytecodeOffset, ...(bytecode ? { bytecode } : {}), ...(emit.comment === undefined ? {} : { comment: emit.comment }) });
      }
    }
  };

  feed(prologue({ registerCount: fn.registerCount, frameSize: fn.frameSize, bytecodeArray: bytecodeArrayPointer(fn.id) }), FUNCTION_ENTRY_BYTECODE_OFFSET);
  for (const bytecode of fn.array.instructions) {
    encoder.bind(at(bytecode.offset));
    const labels: TemplateLabels = { at, local: (name) => encoder.label(`.L${bytecode.offset}_${name}`) };
    feed(TEMPLATES[bytecode.opcode]({ bytecode, fn, labels }), bytecode.offset, bytecode);
  }

  const assembled = encoder.assemble();
  if (!assembled.ok) return err(assembled.error);
  const instructions = assembled.value.instructions.map((encoded, i): BaselineInstruction => {
    const owner = owners[i];
    if (!owner) throw new Error("assembler invariant: instruction without an owner");
    return {
      asm: formatInstruction(encoded.instruction),
      bytes: [...assembled.value.bytes.subarray(encoded.offset, encoded.offset + encoded.length)],
      bytecodeOffset: owner.bytecodeOffset,
      ...(owner.bytecode ? { bytecode: owner.bytecode } : {}),
      instruction: encoded.instruction,
      ...(owner.comment === undefined ? {} : { comment: owner.comment }),
    };
  });
  return ok({ instructions });
}
