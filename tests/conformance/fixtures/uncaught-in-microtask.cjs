// An uncaught error inside a promise reaction job: no Node-internal frames follow the user frame.
console.log("start");
setTimeout(() => console.log("never runs"), 0);
Promise.resolve().then(() => {
  throw new Error("boom in microtask");
});
queueMicrotask(() => console.log("a second microtask never runs either"));
console.log("end of script");
