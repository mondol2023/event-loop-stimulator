// queueMicrotask and promise jobs share one FIFO queue; a job queued while draining goes to the back.
queueMicrotask(() => console.log("microtask A"));
Promise.resolve().then(() => console.log("then B"));
queueMicrotask(() => {
  console.log("microtask C");
  queueMicrotask(() => console.log("nested microtask F"));
  Promise.resolve().then(() => console.log("nested then G"));
});
Promise.resolve()
  .then(() => console.log("then D"))
  .then(() => console.log("then E, one hop later"));
queueMicrotask(() => console.log("microtask H"));

const resolved = Promise.resolve("late then");
queueMicrotask(() => {
  console.log("microtask I");
  resolved.then((v) => console.log(v));
});

(async () => {
  await undefined;
  console.log("async continuation");
})();

console.log("sync");
