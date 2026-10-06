// util.inspect as console.log applies it: depth 2, line breaking at breakLength 80, array grouping above 6 items, quote choice.
console.log({ a: { b: { c: { d: 1 } } } });
console.log({ a: { b: { c: {} } } });
console.log({ a: { b: { c: [] } } });
console.log([[[[1]]]]);
console.log([[[[]]]]);
console.log({ list: [1, [2, [3, [4]]]] });

// A value stays on one line while it is short enough; past that, one entry per line.
console.log({ alpha: "aaaaaaaaaa", beta: "bbbbbbbbbb", gamma: "cccccccccc", delta: "dddddddddd" });
console.log({ alpha: "aaaaaaaaaa", beta: "bbbbbbbbbb", gamma: "cccccccccc", delta: "dddddddddd", epsilon: 1 });
console.log(["aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccc", "dddddddddddddddddddd"]);
console.log({ outer: { inner: { alpha: "aaaaaaaaaa", beta: "bbbbbbbbbb", gamma: "cccccccccc", delta: "dddddd" } } });

// Arrays of more than 6 items are grouped into aligned columns.
console.log([1, 2, 3, 4, 5, 6]);
console.log([1, 2, 3, 4, 5, 6, 7]);
console.log([1, 22, 333, 4444, 55555, 666666, 7777777, 88888888]);
console.log(["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "ggggggg"]);
console.log([1.5, 2.25, 3.125, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);

// More than 100 items are summarized.
const long = [];
for (let i = 0; i < 101; i++) {
  long.push(i);
}
console.log(long);

// Strings: single quotes by default, double if the string has a single quote, backticks if it has both.
console.log(["plain", "it's", 'say "hi"', `it's "both"`, "back`tick", "new\nline", "tab\t", "back\\slash"]);
console.log({ "needs-quotes": 1, valid_id: 2, 3: 3, "a b": 4, "": 5 });

// Other value kinds.
function named() {}
const anonymous = () => {};
console.log({ f: named, g: anonymous, h: function () {}, n: null, u: undefined, t: true, big: 1e21, neg: -0 });
console.log([null, undefined, NaN, -0, "s"], [named, anonymous]);
console.log({}, [], [[]], [{}], { a: {} }, { a: [] });
console.log("top-level strings print raw:", "it's", ["it's"]);

// Several arguments are joined with a space.
console.log("values", 1, "two", { three: 3 }, [4], null, undefined);
console.log({ a: 1 }, "between", [2]);
