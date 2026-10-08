"use strict";
// In a strict module every function sees `this` as passed.
function plain() {
  return this;
}
plain();
const arrow = () => this;
arrow();
function nested() {
  const inner = function () {
    return this;
  };
  return inner();
}
nested();
const top = this;
