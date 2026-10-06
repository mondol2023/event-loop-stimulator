// An error thrown from a timer callback is uncaught: the stack shows the timer frames, exit code 1,
// and callbacks still queued behind it never run.
console.log("start");
setTimeout(() => {
  console.log("timer runs");
  throw new Error("thrown in a timer");
}, 0);
setTimeout(() => console.log("a later timer never runs"), 20);
process.nextTick(() => console.log("tick before the timer"));
Promise.resolve().then(() => console.log("microtask before the timer"));
console.log("end of script");
