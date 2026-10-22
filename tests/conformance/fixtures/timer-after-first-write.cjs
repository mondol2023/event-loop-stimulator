// A timer armed after the first console write races one armed before it: the write's real cost decides.
setTimeout(() => console.log("t5"), 5);
console.log("x");
setTimeout(() => console.log("t0"), 0);
