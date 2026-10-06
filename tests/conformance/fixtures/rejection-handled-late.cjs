// The unhandled-rejection check runs after the whole tick and microtask drain, so a handler attached late
// (from a tick, or several promise hops later) still counts and nothing is reported.
const first = Promise.reject(new Error("first rejection"));
process.nextTick(() => {
  console.log("attaching a handler from a tick");
  first.catch((e) => console.log("handled late: " + e.message));
});

const second = Promise.reject(new Error("second rejection"));
Promise.resolve()
  .then(() => {})
  .then(() => {})
  .then(() => {})
  .then(() => {
    console.log("attaching a handler three hops later");
    second.catch((e) => console.log("handled later still: " + e.message));
  });

const third = Promise.reject(new Error("third rejection"));
(async () => {
  await null;
  try {
    await third;
  } catch (e) {
    console.log("handled by an await: " + e.message);
  }
})();

// then without a rejection handler passes the rejection on; the last link handles it.
const fourth = Promise.reject(new Error("fourth rejection"));
fourth.then(() => console.log("not reached")).catch((e) => console.log("handled at the end of the chain: " + e.message));

console.log("end of script");
