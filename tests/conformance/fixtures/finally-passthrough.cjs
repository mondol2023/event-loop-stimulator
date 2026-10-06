// finally passes the value or the rejection through, ignores its own return value, and costs extra turns.
Promise.resolve("value")
  .finally(() => {
    console.log("finally on fulfilled: runs with no argument");
    return "ignored return value";
  })
  .then((v) => console.log("after finally: " + v));

Promise.reject(new Error("rejection"))
  .finally(() => console.log("finally on rejected"))
  .catch((e) => console.log("after finally: " + e.message));

Promise.resolve("v")
  .finally(() => {
    throw new Error("thrown in finally");
  })
  .then(
    () => console.log("not reached"),
    (e) => console.log("finally replaced the result: " + e.message),
  );

Promise.reject(new Error("original"))
  .finally(() => {
    throw new Error("override");
  })
  .catch((e) => console.log("override wins: " + e.message));

Promise.resolve("kept")
  .finally(() => Promise.reject(new Error("rejected from finally")))
  .catch((e) => console.log("returned rejection wins: " + e.message));

Promise.resolve("kept")
  .finally(() => Promise.resolve("ignored again"))
  .then((v) => console.log("returned fulfillment is ignored: " + v));

Promise.resolve("arg")
  .finally((x) => console.log("finally argument: " + x))
  .then((v) => console.log("still " + v));

// finally waits for the promise it returns before passing the result on.
Promise.resolve("waited")
  .finally(
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          console.log("finally promise settled");
          resolve();
        }, 5);
      }),
  )
  .then((v) => console.log("then after waiting: " + v));

// Turns: after then(f) the next handler runs on turn 2; after finally(f) it waits until turn 4.
let turn = 0;
function counter(limit) {
  function step() {
    turn++;
    console.log("-- turn " + turn);
    if (turn < limit) {
      Promise.resolve().then(step);
    }
  }
  Promise.resolve().then(step);
}
counter(5);
Promise.resolve("a")
  .then((v) => v)
  .then((v) => console.log("then then: " + v));
Promise.resolve("b")
  .finally(() => {})
  .then((v) => console.log("finally then: " + v));
