// Bytecode micro-fixture: array literals, constant, holey, nested and with values computed at run time.
var x = 1;
var empty = [];
var smis = [1, 2, 3];
var doubles = [1.5, 2.5];
var strings = ["a", "b"];
var holes = [1, , 3];
var leadingHole = [, 1];
var onlyHoles = [, ,];
var computed = [x, x + 1, 3];
var tailComputed = [1, 2, x];
var nested = [[1], [2, [3]]];
var mixed = [1, "a", null, true, undefined];
var objects = [{ a: 1 }, { b: x }];
var functions = [() => 1, function () {}];
console.log(empty, smis, doubles, strings, holes, leadingHole, onlyHoles, computed, tailComputed, nested, mixed, objects, functions.length);
function make(a) {
  return [a, , a + 1];
}
console.log(make(1), [-1, -0, 1e21]);
