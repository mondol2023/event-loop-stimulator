// let and const are hoisted but stay uninitialized (the temporal dead zone) until their declaration runs.
console.log("start");
try {
  console.log(x);
} catch (e) {
  console.log(e.name + ": " + e.message);
}
try {
  console.log(typeof z);
} catch (e) {
  console.log(e.name + ": " + e.message);
}
let x = 1;
const z = 2;
console.log("x is", x, "z is", z);

function read() {
  return y;
}
console.log("calling read before y is initialized");
console.log(read());
let y = 3;
console.log("not reached");
