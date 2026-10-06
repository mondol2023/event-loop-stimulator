// An uncaught TypeError: Node prints the source line with a caret, the error, the stack and the version, exit code 1.
function readX(o) {
  return o.x;
}
function wrapper() {
  return readX(undefined);
}
console.log("before");
console.log(wrapper());
console.log("not reached");
