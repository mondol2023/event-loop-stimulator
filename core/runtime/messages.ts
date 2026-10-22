// V8's message templates for the pinned version (src/common/message-template.h, V8 13.6). One
// closed table: an entry is added only with a fixture that prints it. The text is copied from the
// header verbatim; each `%` takes the next argument (MessageFormatter::Format).

const MESSAGE_TEMPLATES = {
  kAccessedUninitializedVariable: "Cannot access '%' before initialization",
  kAllPromisesRejected: "All promises were rejected",
  kBadSortComparisonFunction: "The comparison function must be either a function or undefined: %",
  kCalledNonCallable: "% is not a function",
  kCalledOnNonObject: "% called on non-object",
  kConstAssign: "Assignment to constant variable.",
  kFunctionBind: "Bind must be called on a function",
  kIncompatibleMethodReceiver: "Method % called on incompatible receiver %",
  kInvalidArrayLength: "Invalid array length",
  kNonObjectPropertyLoadWithProperty: "Cannot read properties of % (reading '%')",
  kNonObjectPropertyStoreWithProperty: "Cannot set properties of % (setting '%')",
  kNotConstructor: "% is not a constructor",
  kNotDefined: "% is not defined",
  kNotGeneric: "% requires that 'this' be a %",
  // The texts of the next two were probed on node 24.19.0; the template names are from memory of
  // message-template.h (kResolverNotAFunction is certain, the "without new" name is not).
  kPromiseConstructorWithoutNew: "Promise constructor cannot be invoked without 'new'",
  kPromiseCyclic: "Chaining cycle detected for promise %",
  kPromiseExecutorAlreadyInvoked: "Promise executor has already been invoked with non-undefined arguments",
  kPromiseNonCallable: "Promise resolve or reject function is not callable",
  kReduceNoInitial: "Reduce of empty array with no initial value",
  kRestrictedFunctionProperties:
    "'caller', 'callee', and 'arguments' properties may not be accessed on strict mode functions or the arguments objects for calls to them",
  kResolverNotAFunction: "Promise resolver % is not a function",
  kStrictCannotCreateProperty: "Cannot create property '%' on % '%'",
  kStrictReadOnlyProperty: "Cannot assign to read only property '%' of % '%'",
  kUndefinedOrNullToObject: "Cannot convert undefined or null to object",
} as const;

export type MessageTemplate = keyof typeof MESSAGE_TEMPLATES;

/** `MessageFormatter::Format`. A wrong argument count is a programmer error. */
export function formatMessage(template: MessageTemplate, ...args: readonly string[]): string {
  const parts = MESSAGE_TEMPLATES[template].split("%");
  if (parts.length - 1 !== args.length) {
    throw new Error(`${template} expects ${parts.length - 1} argument(s), got ${args.length}`);
  }
  return parts.reduce((out, part, i) => out + (args[i - 1] ?? "") + part);
}
