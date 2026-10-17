// An uncaught error inside a setImmediate callback: Immediate.<anonymous> plus the processImmediate tail.
console.log("start");
setImmediate(() => {
  throw new Error("boom in immediate");
});
setImmediate(() => console.log("the second immediate never runs"));
console.log("end of script");
