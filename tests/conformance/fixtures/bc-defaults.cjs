// Default parameters: evaluated on each call that passes undefined, left to right.
function greet(name = 1, punctuation = 2) {
  return name + punctuation;
}
greet();
function area(width, height = width) {
  return width * height;
}
area(4);
let calls = 0;
function next() {
  calls = calls + 1;
  return calls;
}
function withCounter(id = next()) {
  return id;
}
withCounter();
function early(a = b, b = 1) {
  return a + b;
}
early(5);
const arrow = (x = 5, y = x * 2) => x + y;
arrow();
function viaClosure(x = 1, read = () => x) {
  x = 99;
  return read();
}
viaClosure();
