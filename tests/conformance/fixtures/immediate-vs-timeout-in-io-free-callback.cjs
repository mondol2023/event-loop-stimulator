// From inside a timer callback the check phase comes before the next timers phase, so the immediate always wins.
setTimeout(() => {
  setTimeout(() => console.log("timeout"), 0);
  setImmediate(() => console.log("immediate"));
}, 1);
