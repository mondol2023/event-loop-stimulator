"use strict";
// Strict mode: this is not coerced to the global object, and sloppy-only assignments throw.
console.log(this === module.exports);

function plain() {
  return this;
}
console.log(plain());
console.log(typeof plain());

const holder = {
  method() {
    return this === holder;
  },
};
console.log(holder.method());
const detached = holder.method;
console.log(detached());

const arrow = () => this === module.exports;
console.log(arrow());

function inner() {
  return (function () {
    return this;
  })();
}
console.log(inner());

try {
  undeclaredAssignment = 1;
} catch (e) {
  console.log(e.name + ": " + e.message);
}

function readThis() {
  return this.value;
}
try {
  readThis();
} catch (e) {
  console.log(e.name + ": " + e.message);
}
