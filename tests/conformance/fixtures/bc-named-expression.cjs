// A named function expression sees its own name.
function outer() {
  const fact = function inner(n) { return n < 2 ? 1 : n * inner(n - 1); };
  return fact(3);
}
outer();
function viaClosure() {
  const g = function self() { return () => self; };
  return g()();
}
viaClosure();
