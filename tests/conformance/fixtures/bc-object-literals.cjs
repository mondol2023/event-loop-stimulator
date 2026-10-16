// Bytecode micro-fixture: object literals, constant and with values computed at run time.
var x = 1;
var empty = {};
var constant = { a: 1, b: "two", c: true, d: null };
var computed = { a: x, b: x + 1, c: 3 };
var shorthand = { x, empty };
var nested = { inner: { deep: { v: 1 } }, list: [1, 2] };
var keys = { 2: "two", 1: "one", "quoted key": 3, "-1": 4 };
var withFunctions = {
  arrow: () => 1,
  method() {
    return this.arrow();
  },
  named: function inner() {
    return 2;
  },
};
var mixed = { first: x, second: 2, third: { x } };
console.log(empty, constant, computed, shorthand, nested, keys, withFunctions.method(), withFunctions.named(), mixed);
function make(a, b) {
  return { a, b, sum: a + b, fixed: 1 };
}
console.log(make(1, 2), { undefinedValue: undefined, negative: -1, float: 1.5 });
