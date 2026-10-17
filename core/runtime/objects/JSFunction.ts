import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import type { Completion } from "@/core/interpreter/Completion";
import type { ObjectId } from "@/core/shared/ids";
import type { FunctionKind } from "../builtins/inspect";
import type { Realm } from "../Realm";
import type { JSValue } from "../values/JSValue";
import type { Context } from "./Context";
import { JSObject } from "./JSObject";
import type { V8Map } from "./V8Map";

/** A builtin: runs on the host, called with the receiver and the arguments of the call. */
export type NativeFunction = (realm: Realm, receiver: JSValue, args: readonly JSValue[]) => Completion;

export interface JSFunctionInit {
  /** The bytecode of a user function; absent for a builtin. */
  readonly code?: BytecodeFunction | undefined;
  readonly native?: NativeFunction | undefined;
  readonly context: Context;
  readonly kind?: FunctionKind;
}

/** V8's JSFunction: a closure over a Context (user code) or a builtin. `name` and `length` are ordinary properties. */
export class JSFunction extends JSObject {
  readonly code: BytecodeFunction | undefined;
  readonly native: NativeFunction | undefined;
  readonly context: Context;
  readonly kind: FunctionKind;

  constructor(id: ObjectId, map: V8Map, prototype: JSObject | null, init: JSFunctionInit) {
    super(id, map, prototype);
    this.code = init.code;
    this.native = init.native;
    this.context = init.context;
    this.kind = init.kind ?? "normal";
  }

  override get isCallable(): boolean {
    return true;
  }
}
