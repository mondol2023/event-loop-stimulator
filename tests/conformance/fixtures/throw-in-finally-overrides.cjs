// A throw inside finally replaces the pending completion, and so does a return.
function a() {
  try {
    throw new Error("from try");
  } finally {
    console.log("a finally");
  }
}
try {
  a();
} catch (e) {
  console.log("caught", e.message);
}
function b() {
  try {
    throw new Error("from try");
  } finally {
    throw new Error("from finally");
  }
}
try {
  b();
} catch (e) {
  console.log("caught", e.message);
}
function c() {
  try {
    throw new Error("from try");
  } finally {
    return "return wins";
  }
}
console.log(c());
