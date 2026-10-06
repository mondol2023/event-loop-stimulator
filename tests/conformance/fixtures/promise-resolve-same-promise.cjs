// Promise.resolve(p) returns p itself when p is a native promise; new Promise(r => r(p)) makes a new one.
const p = Promise.resolve(1);
console.log(Promise.resolve(p) === p);
console.log(new Promise((resolve) => resolve(p)) === p);
console.log(p.then(() => {}) === p);
const failed = Promise.reject(new Error("failed"));
failed.catch(() => {});
console.log(Promise.resolve(failed) === failed);
const wrapped = Promise.reject(p);
wrapped.catch(() => {});
console.log(wrapped === p);

const thenable = {
  then(resolve) {
    resolve("from thenable");
  },
};
console.log(Promise.resolve(thenable) === thenable, typeof Promise.resolve(thenable).then);

// Registration order on the very same promise is call order; the wrapper arrives later.
p.then(() => console.log("handler on p, first"));
Promise.resolve(p).then(() => console.log("handler via Promise.resolve(p), second"));
new Promise((resolve) => resolve(p)).then(() => console.log("handler via new Promise(r => r(p)), two turns later"));
p.then(() => console.log("handler on p, third"));

// A promise resolved with itself rejects with a TypeError.
let resolveSelf;
const self = new Promise((resolve) => {
  resolveSelf = resolve;
});
resolveSelf(self);
self.then(
  () => console.log("not reached"),
  (e) => console.log(e.name + ": " + e.message),
);

// Settling twice: only the first call counts.
const once = new Promise((resolve, reject) => {
  resolve("first");
  resolve("second");
  reject(new Error("ignored"));
});
once.then((v) => console.log("settled once with " + v));

// An executor that throws rejects the promise, unless it was already resolved.
new Promise(() => {
  throw new Error("executor threw");
}).catch((e) => console.log("rejected: " + e.message));
new Promise((resolve) => {
  resolve("resolved first");
  throw new Error("ignored throw");
}).then((v) => console.log(v));
