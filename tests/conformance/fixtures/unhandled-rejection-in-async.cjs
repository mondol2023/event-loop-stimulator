// An async function throws and nobody awaits it: the rejection is unhandled once the microtasks drain.
async function f() {
  throw new Error("async boom");
}
console.log("start");
f();
setTimeout(() => console.log("never runs"), 0);
console.log("end of script");
