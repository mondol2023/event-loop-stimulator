// A delay above 2**31 - 1 does not fit a 32-bit signed integer: the timer runs after 1 ms and a
// TimeoutOverflowWarning goes to stderr (the "--trace-warnings" hint is printed only for the first warning).
setTimeout(() => console.log("first timer fired after the delay was coerced to 1"), 2 ** 31);
setTimeout(() => console.log("second timer fired after the delay was coerced to 1"), 2 ** 32);
setTimeout(() => console.log("an ordinary timer, 20 ms"), 20);
console.log("scheduled");
