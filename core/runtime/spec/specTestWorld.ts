import type { Completion } from "@/core/interpreter/Completion";
import { Heap } from "../heap/Heap";
import { JSObject } from "../objects/JSObject";
import { TransitionTree } from "../objects/TransitionTree";
import type { JSValue } from "../values/JSValue";
import { StringBudget } from "../WorkBudget";
import { OrdinarySet } from "./objectOps";
import type { SpecRealm } from "./conversions";

// Test-only scaffolding for the spec operations: a heap, plain objects, and callable objects
// backed by host closures standing in for user functions (JSFunction arrives in Task 9).

export type TestBehavior = (receiver: JSValue, args: readonly JSValue[]) => Completion;

export class TestFunction extends JSObject {
  readonly behavior: TestBehavior;

  constructor(id: JSObject["id"], map: JSObject["map"], behavior: TestBehavior) {
    super(id, map, null);
    this.behavior = behavior;
  }

  override get isCallable(): boolean {
    return true;
  }
}

export function specTestWorld() {
  const heap = new Heap();
  const maps = new TransitionTree();
  const ctx = { maps };
  const calls: string[] = [];
  const realm: SpecRealm = {
    strings: new StringBudget(),
    call(fn, receiver, args) {
      if (!(fn instanceof TestFunction)) throw new Error("test realm can only call TestFunction");
      return fn.behavior(receiver, args);
    },
    throwTypeError(message) {
      return { type: "throw", value: `TypeError: ${message}` };
    },
  };
  const fn = (name: string, behavior: TestBehavior): TestFunction =>
    heap.allocate(
      (id) =>
        new TestFunction(id, maps.rootFor("function", 0), (receiver, args) => {
          calls.push(name);
          return behavior(receiver, args);
        }),
    );
  const object = (props: Record<string, JSValue> = {}): JSObject => {
    const entries = Object.entries(props);
    const o = heap.allocate((id) => new JSObject(id, maps.rootFor("object-literal", entries.length), null));
    for (const [k, v] of entries) OrdinarySet(ctx, o, k, v);
    return o;
  };
  /** An object whose valueOf and toString return the given completions. */
  const convertible = (valueOf?: Completion, toString?: Completion): JSObject =>
    object({
      ...(valueOf && { valueOf: fn("valueOf", () => valueOf) }),
      ...(toString && { toString: fn("toString", () => toString) }),
    });
  return { heap, maps, ctx, realm, calls, fn, object, convertible };
}
