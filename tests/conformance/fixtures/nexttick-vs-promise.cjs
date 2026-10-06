// After the main script, process.nextTick callbacks drain first, then promise jobs; the two queues then alternate.
console.log("sync 1");

Promise.resolve()
  .then(() => {
    console.log("promise 1");
    process.nextTick(() => console.log("tick scheduled from a promise job"));
  })
  .then(() => console.log("promise 2"));

process.nextTick(() => {
  console.log("tick 1");
  Promise.resolve().then(() => console.log("promise scheduled from a tick"));
  process.nextTick(() => console.log("tick scheduled from a tick"));
});

process.nextTick(() => console.log("tick 2"));

Promise.resolve().then(() => console.log("promise 3"));

console.log("sync 2");
