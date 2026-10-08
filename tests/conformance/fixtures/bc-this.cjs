// "this": the module's receiver at top level, the call's receiver in functions, captured by arrows.
function sloppy() {
  return this;
}
sloppy();
function strictFn() {
  "use strict";
  return this;
}
strictFn();
const topArrow = () => this;
topArrow();
function withArrow() {
  const read = () => this;
  return read();
}
withArrow();
function useThis() {
  const v = this;
  return v;
}
useThis();
const viaTop = this;
