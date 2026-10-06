// Default parameters are evaluated at call time, left to right, only for undefined, in their own scope.
function greet(name = "stranger", punctuation = "!") {
  return "hello " + name + punctuation;
}
console.log(greet());
console.log(greet("Ada"));
console.log(greet("Ada", "?"));
console.log(greet(undefined, "."));
console.log(greet(null));
console.log(greet(""));

// Later defaults can use earlier parameters.
function area(width, height = width) {
  return width * height;
}
console.log(area(4), area(4, 3));

// A default is evaluated on every call that needs it.
let calls = 0;
function next() {
  calls = calls + 1;
  return calls;
}
function withCounter(id = next()) {
  return id;
}
console.log(withCounter(), withCounter(), withCounter(100), withCounter(), calls);

// A default can be a fresh object each time.
function withList(list = []) {
  list.push("x");
  return list;
}
console.log(withList(), withList(), withList(["y"]));

// A default that reads a later parameter sits in the temporal dead zone.
function early(a = b, b = 1) {
  return [a, b];
}
try {
  early();
} catch (e) {
  console.log(e.name + ": " + e.message);
}
console.log(early(5));

const arrow = (x = 5, y = x * 2) => x + y;
console.log(arrow(), arrow(1), arrow(1, 1), arrow(undefined, 0));

// Defaults see the enclosing scope, and a closure in a default sees the parameters.
const base = 10;
function viaOuter(x = base) {
  return x;
}
console.log(viaOuter(), viaOuter(1));
function viaClosure(x = 1, read = () => x) {
  x = 99;
  return read();
}
console.log(viaClosure());

function side(trace, a = trace.push("a"), b = trace.push("b")) {
  return [trace, a, b];
}
console.log(side([]), side([], 0), side([], undefined, 0));
