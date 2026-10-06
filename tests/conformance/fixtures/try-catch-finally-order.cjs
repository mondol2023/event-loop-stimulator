// finally always runs, and a finally that returns, breaks or throws overrides what try/catch decided.
function log(msg) {
  console.log(msg);
}

function plain() {
  try {
    log("try");
  } catch (e) {
    log("catch " + e);
  } finally {
    log("finally");
  }
  log("after");
}
plain();

function thrown() {
  try {
    log("try");
    throw new Error("boom");
  } catch (e) {
    log("catch " + e.message);
  } finally {
    log("finally");
  }
}
thrown();

function returnInTry() {
  try {
    log("try");
    return "from try";
  } finally {
    log("finally runs before the return completes");
  }
}
log(returnInTry());

function returnInFinally() {
  try {
    return "from try";
  } finally {
    return "from finally";
  }
}
log(returnInFinally());

function finallyOverridesThrow() {
  try {
    throw new Error("lost");
  } finally {
    return "swallowed the throw";
  }
}
log(finallyOverridesThrow());

function throwInCatch() {
  try {
    throw new Error("first");
  } catch (e) {
    log("catch " + e.message);
    throw new Error("second");
  } finally {
    log("finally after catch rethrow");
  }
}
try {
  throwInCatch();
} catch (e) {
  log("outer " + e.message);
}

function nested() {
  try {
    try {
      throw new Error("inner");
    } finally {
      log("inner finally");
    }
  } catch (e) {
    log("outer catch " + e.message);
  } finally {
    log("outer finally");
  }
}
nested();

function inLoop() {
  for (let i = 0; i < 3; i++) {
    try {
      if (i === 0) continue;
      if (i === 2) break;
      log("body " + i);
    } finally {
      log("finally " + i);
    }
  }
  log("loop done");
}
inLoop();

// The value of a variable read after finally reflects the order of side effects.
let trace = "";
function order() {
  try {
    trace = trace + "t";
    return trace;
  } finally {
    trace = trace + "f";
  }
}
log(order() + " " + trace);

try {
  throw 42;
} catch (value) {
  log("caught " + value + " " + typeof value);
}
