import { Context } from "../objects/Context";
import { HeapObject } from "../objects/HeapObject";
import { JSAsyncFunctionObject, JSGeneratorObject } from "../objects/JSGeneratorObject";
import { JSFunction } from "../objects/JSFunction";
import { JSObject } from "../objects/JSObject";
import { JSPromise } from "../objects/JSPromise";

// What the modeled collector can reach from its roots (frames, contexts, queues, timers and the
// global object). It reads the object graph and nothing else: it reads stored values directly, so
// no getter runs and an Error's `stack` is never formatted.

/** Every heap object and Context reachable from `roots`; anything else in `roots` (a primitive, undefined) is ignored. */
export function reachableFrom(roots: Iterable<unknown>): ReadonlySet<unknown> {
  const seen = new Set<unknown>();
  const pending: unknown[] = [];
  const visit = (value: unknown): void => {
    if ((value instanceof HeapObject || value instanceof Context) && !seen.has(value)) {
      seen.add(value);
      pending.push(value);
    }
  };
  for (const root of roots) visit(root);
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) edgesOf(node, visit);
  return seen;
}

function edgesOf(node: unknown, visit: (value: unknown) => void): void {
  if (node instanceof Context) {
    visit(node.parent);
    node.slots.forEach(visit);
    return;
  }
  if (!(node instanceof JSObject)) return;
  visit(node.prototype);
  node.properties.fast.forEach(visit);
  node.properties.dictionary?.forEach((entry) => visit(entry.value));
  node.elements.dense.forEach(visit);
  node.elements.dictionary?.forEach(visit);
  if (node instanceof JSFunction) {
    visit(node.context);
    node.captures.forEach(visit);
  }
  if (node instanceof JSPromise) {
    visit(node.result);
    for (const reaction of [...node.fulfillReactions, ...node.rejectReactions]) {
      visit(reaction.handler);
      visit(reaction.capability?.promise);
      visit(reaction.capability?.resolve);
      visit(reaction.capability?.reject);
    }
  }
  if (node instanceof JSGeneratorObject) {
    visit(node.function);
    visit(node.receiver);
    visit(node.context);
    visit(node.inputOrDebugPos);
    node.parameters.forEach(visit);
    node.registers.forEach(visit);
  }
  if (node instanceof JSAsyncFunctionObject) visit(node.promise);
}
