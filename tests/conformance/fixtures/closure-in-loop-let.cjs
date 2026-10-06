// let in a for loop creates a fresh binding per iteration (CreatePerIterationEnvironment); var shares one.
const withLet = [];
for (let i = 0; i < 3; i++) {
  withLet.push(() => i);
}
console.log(withLet.map((f) => f()));

const withVar = [];
for (var v = 0; v < 3; v++) {
  withVar.push(() => v);
}
console.log(withVar.map((f) => f()));

// The body can change the binding of its own iteration; the copy for the next iteration carries the change.
const mutated = [];
for (let i = 0; i < 6; i++) {
  mutated.push(() => i);
  i++;
}
console.log(mutated.map((f) => f()));

// A closure created in the update expression sees the new iteration's binding, after the copy.
const fromUpdate = [];
function record(read) {
  fromUpdate.push(read);
  return 1;
}
for (let i = 0; i < 3; i += record(() => i)) {}
console.log(fromUpdate.map((f) => f()));

// const in the body is a new binding every time.
const fromBody = [];
for (let i = 0; i < 3; i++) {
  const squared = i * i;
  fromBody.push(() => squared + i);
}
console.log(fromBody.map((f) => f()));

// Closures in a while loop capture the block's binding, one per iteration.
const fromWhile = [];
let w = 0;
while (w < 3) {
  let copy = w;
  fromWhile.push(() => copy);
  w++;
}
console.log(fromWhile.map((f) => f()));

// A timer callback created in a loop reads the binding when it runs.
for (let t = 0; t < 3; t++) {
  setTimeout(() => console.log("timer let", t), 0);
}
for (var u = 0; u < 3; u++) {
  setTimeout(() => console.log("timer var", u), 0);
}
