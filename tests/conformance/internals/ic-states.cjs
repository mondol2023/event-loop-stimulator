// Inline-cache states seen through %DebugPrint. Only %DebugPrint writes: mixed with console.log the streams would interleave.
function uninit(o) {
  if (o === null) {
    return o.x;
  }
  return 0;
}
function mono(o) {
  return o.x;
}
function poly(o) {
  return o.x;
}
function mega(o) {
  return o.x;
}
function keyed(o, k) {
  return o[k];
}
function store(o) {
  o.x = 1;
}
uninit({ x: 1 });
mono({ x: 1 });
mono({ x: 2 });
poly({ x: 1 });
poly({ x: 1, a: 1 });
poly({ x: 1, b: 1 });
mega({ x: 1 });
mega({ x: 1, a: 1 });
mega({ x: 1, b: 1 });
mega({ x: 1, c: 1 });
mega({ x: 1, d: 1 });
keyed({ x: 1 }, "x");
keyed({ x: 1 }, "x");
store({});
store({});
%DebugPrint(uninit);
%DebugPrint(mono);
%DebugPrint(poly);
%DebugPrint(mega);
%DebugPrint(keyed);
%DebugPrint(store);
