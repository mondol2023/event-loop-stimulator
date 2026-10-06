// Node coerces the delay with Number(): anything below 1, NaN or non-numeric becomes 1 ms; "20" is 20 ms.
// The 1 ms group runs in creation order, then the 20 ms timers. Node 24 also writes a TimeoutNegativeWarning
// (for -1) and a TimeoutNaNWarning (for NaN) to stderr, each only the first time it happens in a process.
setTimeout(() => console.log('"20" (20 ms)'), "20");
setTimeout(() => console.log("0"), 0);
setTimeout(() => console.log("-1"), -1);
setTimeout(() => console.log("NaN"), NaN);
setTimeout(() => console.log("undefined"), undefined);
setTimeout(() => console.log("omitted"));
setTimeout(() => console.log("null"), null);
setTimeout(() => console.log('"abc"'), "abc");
setTimeout(() => console.log("true"), true);
setTimeout(() => console.log("0.5"), 0.5);
setTimeout(() => console.log("-Infinity"), -Infinity);
setTimeout(() => console.log("1"), 1);
setTimeout(() => console.log('"20" again'), "20");
console.log("scheduled");
