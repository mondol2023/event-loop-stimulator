// In an async function, return of a promise costs two extra turns over return await; only return await is caught.
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

const inner = () => Promise.resolve("value");

async function returnPlainValue() {
  return "value";
}
async function returnAwait() {
  return await inner();
}
async function returnPromise() {
  return inner();
}

counter(5);
returnPlainValue().then((v) => console.log("return value settled: " + v));
returnAwait().then((v) => console.log("return await settled: " + v));
returnPromise().then((v) => console.log("return promise settled: " + v));

// Inside try/catch only return await catches the rejection.
async function awaitsInsideTry() {
  try {
    return await Promise.reject(new Error("rejected"));
  } catch (e) {
    return "caught inside: " + e.message;
  }
}
async function returnsInsideTry() {
  try {
    return Promise.reject(new Error("rejected"));
  } catch (e) {
    return "caught inside: " + e.message;
  }
}
awaitsInsideTry().then(console.log);
returnsInsideTry().then(console.log, (e) => console.log("not caught inside, rejected with: " + e.message));
