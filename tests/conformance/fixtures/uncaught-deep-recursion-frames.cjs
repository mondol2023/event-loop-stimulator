// Twenty nested frames are cut to the 10 that Error.stackTraceLimit keeps, loader frames included.
function r(n) {
  if (n === 0) {
    throw new Error("deep");
  }
  r(n - 1);
}
r(20);
