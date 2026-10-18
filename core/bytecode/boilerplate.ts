// The data of V8's ObjectBoilerplateDescription / ArrayBoilerplateDescription: what the
// CreateObjectLiteral and CreateArrayLiteral bytecodes copy into a fresh object. A value known at
// compile time is stored as it is; a value only known at run time is a placeholder Smi that the
// bytecode after the Create* overwrites (DefineNamedOwnProperty, StaInArrayLiteral).

export type BoilerplateValue =
  | { readonly kind: "value"; readonly value: undefined | null | boolean | number | string }
  | ObjectBoilerplate
  | ArrayBoilerplate
  | { readonly kind: "placeholder" };

export type ObjectBoilerplate = {
  readonly kind: "object";
  /** In source order; an integer-index key lands in the object's elements. */
  readonly properties: readonly { readonly key: string; readonly value: BoilerplateValue }[];
};

export type ArrayBoilerplate = {
  readonly kind: "array";
  readonly elements: readonly (BoilerplateValue | "hole")[];
};
