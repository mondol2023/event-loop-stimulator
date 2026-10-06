// A CommonJS main script is the body of function (exports, require, module, __filename, __dirname).
console.log(this === module.exports, this === exports, exports === module.exports);
console.log(typeof require, typeof module, typeof exports, typeof __filename, typeof __dirname);
console.log(this, module.exports);

this.fromThis = 1;
exports.fromExports = 2;
module.exports.fromModule = 3;
console.log(module.exports);

const arrow = () => this === module.exports;
console.log(arrow());

// In a sloppy function called plainly, this is the global object, not module.exports.
function sloppy() {
  return typeof this;
}
console.log(sloppy(), (function () { return this === module.exports; })());

const holder = {
  method() {
    return this === holder;
  },
};
console.log(holder.method());
const detached = holder.method;
console.log(detached());

// Reassigning module.exports does not change this or exports.
module.exports = { replaced: true };
console.log(this === module.exports, this === exports, this);

// A top-level var is local to the module, not a property of the global object or of this.
var topLevelVar = 1;
console.log(this.topLevelVar, typeof topLevelVar);
