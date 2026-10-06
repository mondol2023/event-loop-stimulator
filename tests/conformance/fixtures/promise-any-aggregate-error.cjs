// Promise.any fulfills with the first fulfillment; if every input rejects it rejects with an AggregateError.
const reasons = (list) => list.map((r) => (typeof r === "object" ? r.message : r));

Promise.any([Promise.reject(new Error("a")), Promise.reject("b"), Promise.reject(3)]).catch((e) => {
  console.log(e.name, "|", e.message);
  console.log(e.errors.length, reasons(e.errors));
  console.log(typeof e.stack, Object.keys(e));
});

Promise.any([]).catch((e) => console.log("empty:", e.name, "|", e.message, e.errors));

Promise.any([Promise.reject("ignored"), Promise.resolve("winner"), Promise.resolve("later")]).then((v) =>
  console.log("any fulfills with:", v),
);

Promise.any([1, Promise.reject("x")]).then((v) => console.log("plain value wins:", v));

const later = (value, ms) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const failLater = (reason, ms) => new Promise((resolve, reject) => setTimeout(() => reject(reason), ms));
Promise.any([failLater("fast failure", 20), later("slow success", 60)]).then((v) =>
  console.log("a late success beats an early failure:", v),
);
Promise.any([failLater("one", 20), failLater("two", 60)]).catch((e) => console.log("errors keep input order:", e.errors));
