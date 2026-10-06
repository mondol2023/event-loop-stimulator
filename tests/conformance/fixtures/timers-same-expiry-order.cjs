// Timers run in order of expiry; timers with the same delay, created back to back, run in creation order.
// Delays are far enough apart that a millisecond tick between two setTimeout calls cannot reorder them.
setTimeout(() => console.log("A 10"), 10);
setTimeout(() => console.log("B 10"), 10);
setTimeout(() => console.log("C 10"), 10);
setTimeout(() => console.log("D 30"), 30);
setTimeout(() => console.log("E 1"), 1);
setTimeout(() => console.log("F 0 (coerced to 1)"), 0);
setTimeout(() => console.log("G 10"), 10);
setTimeout(() => console.log("H 30"), 30);
setTimeout(() => console.log("I 1"), 1);
console.log("scheduled");
