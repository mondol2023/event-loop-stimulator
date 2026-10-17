// A throw inside a map callback unwinds through the builtin frame; the stack shows the callback, map and the caller.
function parse(x) {
  if (x === 2) {
    throw new TypeError("bad " + x);
  }
  return x * 2;
}
try {
  [1, 2, 3].map(parse);
} catch (e) {
  console.log(e.name, e.message);
  console.log(e.stack);
}
let seen = [];
try {
  [1, 2, 3].forEach((x) => {
    seen.push(x);
    if (x === 2) {
      throw new Error("stop");
    }
  });
} catch (e) {
  console.log("stopped after", seen);
}
console.log([1, 2, 3].reduce((a, x) => a + x, 0));
