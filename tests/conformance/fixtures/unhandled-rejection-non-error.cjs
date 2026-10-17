// A rejection whose reason is not an Error is reported as ERR_UNHANDLED_REJECTION.
console.log("start");
Promise.reject(42);
console.log("end of script");
