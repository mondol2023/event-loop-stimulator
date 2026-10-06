// An async function runs synchronously until its first await; await on a native promise costs one tick.
async function async2() {
  console.log("async2");
}
async function async1() {
  console.log("async1 start");
  await async2();
  console.log("async1 end");
}

console.log("script start");
setTimeout(() => console.log("setTimeout"), 0);
async1();
new Promise((resolve) => {
  console.log("promise1");
  resolve();
}).then(() => console.log("promise2"));
console.log("script end");

// Two async functions interleave at every await.
async function a() {
  console.log("a1");
  await null;
  console.log("a2");
  await null;
  console.log("a3");
}
async function b() {
  console.log("b1");
  await null;
  console.log("b2");
  await null;
  console.log("b3");
}
a();
b();

// An async function always returns a promise, and a throw becomes a rejection.
async function value() {
  return 1;
}
async function fails() {
  throw new Error("async failure");
}
console.log(typeof value(), typeof value().then, value() === value());
value().then((v) => console.log("value", v));
fails().catch((e) => console.log("caught", e.message));

async function tryCatch() {
  try {
    await Promise.reject(new Error("awaited rejection"));
    console.log("not reached");
  } catch (e) {
    console.log("tryCatch caught", e.message);
  } finally {
    console.log("tryCatch finally");
  }
  return "tryCatch done";
}
tryCatch().then(console.log);

const arrow = async (x) => (await x) + 1;
arrow(1).then((v) => console.log("arrow", v));
arrow(Promise.resolve(10)).then((v) => console.log("arrow promise", v));
