function early() { return later; }
let later = 1;
const fixed = 2;
let unset;
function useAll() { return later + fixed; }
early();
useAll();
function localTdz() {
  let a = 1;
  const b = a + 1;
  function read() { return c; }
  let c = b;
  return read() + a;
}
localTdz();
function assignCaptured() {
  let n = 0;
  const bump = function () { n = n + 1; };
  bump();
  return n;
}
assignCaptured();
