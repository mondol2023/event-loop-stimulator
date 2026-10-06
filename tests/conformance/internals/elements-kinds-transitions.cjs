// V8 internals probe (run with --allow-natives-syntax): an array's elements kind only ever moves toward the more
// general kind (SMI -> DOUBLE -> OBJECT) and from PACKED to HOLEY, never back.
function kind(array) {
  const holey = %HasHoleyElements(array) ? "HOLEY" : "PACKED";
  if (%HasSmiElements(array)) return holey + "_SMI_ELEMENTS";
  if (%HasDoubleElements(array)) return holey + "_DOUBLE_ELEMENTS";
  if (%HasObjectElements(array)) return holey + "_ELEMENTS";
  if (%HasDictionaryElements(array)) return "DICTIONARY_ELEMENTS";
  return "other";
}

const arr = [1, 2, 3];
console.log("[1, 2, 3]            ", kind(arr));
arr.push(4);
console.log("push(4)              ", kind(arr));
arr.push(4.5);
console.log("push(4.5)            ", kind(arr));
arr.push("x");
console.log("push('x')            ", kind(arr));
arr.pop();
arr.pop();
console.log("pop twice, no way back", kind(arr));

const doubles = [1.5, 2.5];
console.log("[1.5, 2.5]           ", kind(doubles));
doubles.push(3);
console.log("push(3)              ", kind(doubles));
doubles.push({});
console.log("push({})             ", kind(doubles));

const objects = [{}, "s"];
console.log("[{}, 's']            ", kind(objects));
const empty = [];
console.log("[]                   ", kind(empty));
empty.push(1);
console.log("[].push(1)           ", kind(empty));

const holey = [1, 2, 3];
holey[5] = 6;
console.log("hole at 3, 4         ", kind(holey));
holey[3] = 4;
holey[4] = 5;
console.log("holes filled, stays  ", kind(holey));

const literalHole = [1, , 3];
console.log("[1, , 3]             ", kind(literalHole));
const deleted = [1, 2, 3];
delete deleted[1];
console.log("delete a[1]          ", kind(deleted));
const holeyDouble = [1.5, 2.5, 3.5];
holeyDouble[4] = 5.5;
console.log("double with a hole   ", kind(holeyDouble));

const sparse = [1];
sparse[100000] = 2;
console.log("far write            ", kind(sparse));
const shrunk = [1, 2, 3];
shrunk.length = 1;
console.log("length = 1           ", kind(shrunk));
const nan = [NaN, 1];
console.log("[NaN, 1]             ", kind(nan));
const negzero = [1, -0];
console.log("[1, -0]              ", kind(negzero));
const big = [1, 2 ** 31];
console.log("[1, 2 ** 31]         ", kind(big));
const mapped = [1, 2, 3].map((n) => n / 2);
console.log("map(n => n / 2)      ", kind(mapped));
