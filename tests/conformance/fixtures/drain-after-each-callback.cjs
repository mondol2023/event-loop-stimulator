// Since Node 11 the tick queue and the microtask queue drain after every timer or immediate callback,
// not only after the whole timers phase or check phase.
setTimeout(() => {
  console.log("timer 1");
  process.nextTick(() => console.log("  nextTick from timer 1"));
  Promise.resolve().then(() => console.log("  microtask from timer 1"));
}, 0);

setTimeout(() => {
  console.log("timer 2");
  process.nextTick(() => console.log("  nextTick from timer 2"));
  Promise.resolve().then(() => console.log("  microtask from timer 2"));
  queueMicrotask(() => {
    console.log("  queued microtask from timer 2");
    process.nextTick(() => console.log("    nextTick queued by that microtask"));
  });
}, 0);

setTimeout(() => {
  console.log("timer 3");
  setImmediate(() => {
    console.log("immediate A");
    process.nextTick(() => console.log("  nextTick from immediate A"));
    Promise.resolve().then(() => console.log("  microtask from immediate A"));
  });
  setImmediate(() => {
    console.log("immediate B");
    process.nextTick(() => console.log("  nextTick from immediate B"));
    Promise.resolve().then(() => console.log("  microtask from immediate B"));
  });
}, 0);
