// Bytecode micro-fixture: new with and without arguments, and delete in sloppy and strict code.
var e = new Error("message");
var bare = new Error();
var p = new Promise(function (resolve) {
  resolve(1);
});
var three = new Array(1, 2, 3);
var o = { a: 1, b: 2, c: 3 };
var k = "b";
console.log(delete o.a, delete o[k], delete o["c"], o, e.message, bare.message, three);
function strictDelete(obj, key) {
  "use strict";
  delete obj.x;
  return delete obj[key];
}
console.log(strictDelete({ x: 1, y: 2 }, "y"), typeof p.then);
