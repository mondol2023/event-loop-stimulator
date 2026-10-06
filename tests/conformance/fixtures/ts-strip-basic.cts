// Node's strip-only TypeScript mode erases types to whitespace; what is left is plain JavaScript.
interface Point {
  x: number;
  y: number;
  label?: string;
}
type Id = string | number;
type Pair<A, B> = [A, B];

const origin: Point = { x: 0, y: 0 };
const named: Point = { x: 1, y: 2, label: "named" };

function identity<T>(value: T): T {
  return value;
}
function describe(p: Point, prefix?: string): string {
  return (prefix ?? "point") + " " + p.x + "," + p.y;
}
const typed = (a: number, b: number): number => a + b;
const generic = <T>(v: T): T => v;

const n: number = identity<number>(41) + 1;
const s = "text" as string;
const loose = 5 as unknown as string;
const config = { retries: 3 } satisfies { retries: number };
const pair: Pair<string, number> = ["a", 1];
const id: Id = 7;

let maybe: string | undefined = undefined as string | undefined;
maybe = "set";
const length = maybe!.length;
const total = typed(1, 2) + generic<number>(3);

declare const ambient: number;
function withDefault(value: number = 10): number {
  return value;
}

console.log(origin, named);
console.log(describe(origin), describe(named, "labelled"));
console.log(n, s, loose, config, pair, id);
console.log(length, total, withDefault(), withDefault(2));
console.log(typeof ambient);
