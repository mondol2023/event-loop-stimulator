// Blocks whose bindings a closure captures get a context of their own.
function blockCapture(c) {
  let outer = 1;
  if (c) {
    let inner = 2;
    const f = () => inner + outer;
    return f();
  }
  return outer;
}
blockCapture(1);
function blockPlain(c) {
  if (c) {
    let a = 1;
    const b = a + 1;
    return b;
  }
  return 0;
}
blockPlain(1);
function blockTdz(c) {
  {
    const g = () => later;
    let later = 5;
    return g();
  }
}
blockTdz(1);
function twoBlocks(c) {
  { let p = 1; const f = () => p; f(); }
  { let q = 2; const g = () => q; g(); }
}
twoBlocks(1);
