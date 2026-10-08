// A captured receiver is copied into the context first, then the captured parameters last to first.
function both(a, b) {
  const x = 1;
  return () => this + a + b + x;
}
both(1, 2)();
function dflt(a = 1) {
  return () => this + a;
}
dflt()();
