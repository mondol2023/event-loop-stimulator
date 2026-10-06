// Microtasks (promise jobs) run to completion before the loop reaches the timers phase.
console.log("script start");

setTimeout(() => console.log("timeout 0"), 0);
setTimeout(() => console.log("timeout 1"), 1);

Promise.resolve()
  .then(() => console.log("promise 1"))
  .then(() => console.log("promise 2"))
  .then(() => console.log("promise 3"));

new Promise((resolve) => {
  console.log("executor runs synchronously");
  resolve();
}).then(() => console.log("promise from executor"));

(async () => {
  console.log("async function starts synchronously");
  await null;
  console.log("async function resumes as a microtask");
})();

// A timer created inside a microtask still waits for the timers phase, behind earlier timers.
Promise.resolve().then(() => {
  setTimeout(() => console.log("timeout created in a microtask"), 0);
});

console.log("script end");
