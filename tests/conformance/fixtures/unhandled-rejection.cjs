// A rejection with no handler once the microtask queue has drained is fatal: stderr gets the error, exit code 1,
// and callbacks still waiting in the timers phase never run.
console.log("start");

setTimeout(() => console.log("a timer scheduled before the rejection never runs"), 0);

Promise.reject(new Error("nobody handles this"));

Promise.resolve().then(() => console.log("microtasks still drain first"));
process.nextTick(() => console.log("and so do ticks"));

console.log("end of script");
