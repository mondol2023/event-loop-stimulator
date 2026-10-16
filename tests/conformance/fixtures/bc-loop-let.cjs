// A loop variable a closure captures gets a fresh context per iteration.
function perIteration(n) {
  let last;
  for (let i = 0; i < n; i = i + 1) {
    last = () => i;
  }
  return last;
}
perIteration(1);
function plainLoop(n) {
  let last = 0;
  for (let i = 0; i < n; i = i + 1) {
    last = i;
  }
  return last;
}
plainLoop(1);
