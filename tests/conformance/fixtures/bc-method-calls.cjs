// Bytecode micro-fixture: calls with a receiver, by argument count, chained and through keys.
var o = {
  zero() { return 0; },
  one(a) { return a; },
  two(a, b) { return a + b; },
  three(a, b, c) { return a + b + c; },
  self() { return this; },
};
var name = "one";
o.zero();
o.one(1);
o.two(1, 2);
o.three(1, 2, 3);
o[name](4);
o["two"](o.one(5), o.zero());
o.self().self().zero();
console.log(o.one(o.two(1, o.three(1, 2, 3))));
function viaParam(target) {
  return target.one(target.zero()) + target.two(1, 2);
}
console.log(viaParam(o), [1, 2].map(o.one).length);
