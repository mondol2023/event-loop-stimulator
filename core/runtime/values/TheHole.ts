declare const holeBrand: unique symbol;

/** V8's the_hole_value: marks an uninitialized binding (TDZ) or an array hole. Not a JS value. */
export type TheHoleValue = { readonly [holeBrand]: true };

export const TheHole: TheHoleValue = Object.freeze({}) as TheHoleValue;

export function isTheHole(v: unknown): v is TheHoleValue {
  return v === TheHole;
}
