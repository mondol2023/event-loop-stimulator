// Assigning to a binding before its declaration, in code that never runs.
function assignFirst(c) {
  if (c) { w = 2; }
  let w = 1;
  return w;
}
assignFirst(0);
