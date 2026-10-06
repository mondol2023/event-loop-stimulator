"use strict";
// Preloaded with `--require` only for the bytecode pass (bytecode-capture.mts),
// never in a recorded run. Right before Node compiles the fixture's main script
// it calls `__silicon_marker__`, whose first call makes V8 print a block named
// after it into the `--print-bytecode` listing. Every block after that marker
// belongs to the main script or to code it ran, which is how the capture finds
// the user's top-level block among the ~100 Node-internal ones.

// getBuiltinModule rather than require(): the repo lints require() imports away.
const Module = process.getBuiltinModule("node:module");

const original = Module.prototype._compile;

function __silicon_marker__() {
  return 0;
}

Module.prototype._compile = function (content, filename, ...rest) {
  if (/(^|[\\/])main\.c[jt]s$/.test(filename)) {
    // Restore first: the main script must compile through Node's own loader.
    Module.prototype._compile = original;
    __silicon_marker__();
  }
  return Reflect.apply(original, this, [content, filename, ...rest]);
};
