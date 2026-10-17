// An uncaught error inside a process.nextTick callback: the frame tail is processTicksAndRejections, and the exit skips the timer.
console.log("start");
setTimeout(() => console.log("never runs"), 0);
process.nextTick(() => {
  throw new Error("boom in nextTick");
});
console.log("end of script");
