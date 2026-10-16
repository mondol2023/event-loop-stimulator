// break and continue leave the contexts of the blocks they jump out of.
function exits(n) {
  let k = 0;
  while (k < n) {
    {
      let c = k;
      const f = () => c;
      if (f() > 2) break;
      if (f() > 1) continue;
      k = k + 1;
    }
  }
  return k;
}
exits(1);
