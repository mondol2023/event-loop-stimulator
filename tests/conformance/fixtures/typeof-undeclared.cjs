// typeof never throws for an undeclared name; reading the name does.
console.log(typeof notDeclaredAnywhere);
console.log(typeof laterVar);
var laterVar = 1;
console.log(typeof laterVar);
console.log(typeof undefined, typeof null, typeof true, typeof 1, typeof "s");
console.log(typeof NaN, typeof Infinity, typeof (() => 1), typeof {}, typeof []);
console.log(typeof typeof 1);
function f() {}
console.log(typeof f, typeof console.log, typeof Promise, typeof console);
try {
  console.log(notDeclaredAnywhere);
} catch (e) {
  console.log(e.name + ": " + e.message);
}
