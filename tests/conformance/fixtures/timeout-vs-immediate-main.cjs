// NONDETERMINISTIC on real Node: from the main module, setTimeout(fn, 0) versus setImmediate(fn) depends on how
// long the process took to get from scheduling the timer to the first pass of the timers phase. A 0 delay is
// coerced to 1 ms, so if less than a millisecond has passed the loop skips the timer and runs the immediate
// first; if a millisecond has passed the timer wins. The recorder runs this fixture many times and keeps every
// distinct outcome (timeout-vs-immediate-main.meta.json); a simulator must flag the order as not guaranteed.
setTimeout(() => console.log("timeout"), 0);
setImmediate(() => console.log("immediate"));
