import type { ObjectId } from "@/core/shared/ids";
import { JSObject } from "./JSObject";
import type { V8Map } from "./V8Map";

/**
 * An object the embedder creates (Node's `Timeout`, `Immediate` and `process`). The model gives
 * it only the properties the loop and the stack-frame formatter read, so its full shape is not
 * modeled: util.inspect stops the run on one (Decision D3) instead of printing a guessed shape.
 */
export class JSHostObject extends JSObject {
  /** The Node class it stands for, as the stop reason names it. */
  readonly hostClass: string;

  constructor(id: ObjectId, map: V8Map, prototype: JSObject | null, hostClass: string) {
    super(id, map, prototype);
    this.hostClass = hostClass;
  }
}
