import type { BytecodePos } from "@/core/views/types";

// V8's JSMessageObject (src/objects/js-objects.h): where an exception was thrown, created by
// Isolate::Throw and kept as the isolate's pending message until a handler clears it with
// `SetPendingMessage`. A finally block saves it in a register and restores it before `ReThrow`,
// so a rethrown exception keeps its original location. Node's uncaught-exception printer reads
// it for the code frame. It is not allocated on the modeled heap: it never reaches JS code.

export class JSMessageObject {
  /** The instruction of the topmost JS frame when the exception was thrown. */
  readonly pos: BytecodePos;

  constructor(pos: BytecodePos) {
    this.pos = pos;
  }
}
