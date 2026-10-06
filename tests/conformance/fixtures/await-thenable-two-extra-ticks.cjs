// How many microtask turns an await or a resolve takes, measured against a counter that logs once per turn.
// await of a non-promise value or a native promise resumes after turn 1. await of a non-promise thenable
// first needs a NewPromiseResolveThenableJob turn (resumes after turn 2); resolving a promise with a promise,
// or returning one from a then callback, costs two extra turns (NewPromiseResolveThenableJob, then its then).
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

const thenable = {
  then(resolve) {
    console.log("thenable.then called");
    resolve("thenable value");
  },
};

async function awaitValue() {
  await 1;
  console.log("await 1 resumed");
}
async function awaitNative() {
  await Promise.resolve(2);
  console.log("await native promise resumed");
}
async function awaitThenable() {
  const v = await thenable;
  console.log("await thenable resumed with " + v);
}
async function awaitResolvedWithPromise() {
  await new Promise((resolve) => resolve(Promise.resolve(3)));
  console.log("await promise-resolved-with-promise resumed");
}
async function awaitThenableThatResolvesLater() {
  await {
    then(resolve) {
      Promise.resolve().then(() => resolve("late"));
    },
  };
  console.log("await thenable that resolves a turn later resumed");
}

counter(7);
awaitValue();
awaitNative();
awaitThenable();
awaitResolvedWithPromise();
awaitThenableThatResolvesLater();

// A then callback that returns a promise delays the derived promise by two extra turns.
Promise.resolve()
  .then(() => "plain value")
  .then((v) => console.log("then after plain return: " + v));
Promise.resolve()
  .then(() => Promise.resolve("promise value"))
  .then((v) => console.log("then after returned promise: " + v));
Promise.resolve()
  .then(() => thenable)
  .then((v) => console.log("then after returned thenable: " + v));
console.log("sync end");
