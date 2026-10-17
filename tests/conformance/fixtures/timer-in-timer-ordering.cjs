// Timers scheduled inside timer callbacks with delays that tie existing timers.
setTimeout(() => {
  console.log("A");
  setTimeout(() => console.log("A1"), 1);
  setTimeout(() => console.log("A0"), 0);
}, 1);
setTimeout(() => console.log("B"), 2);
setTimeout(() => console.log("C"), 1);
