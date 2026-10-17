// e.stack is captured when the Error is constructed; print it caught at three depths.
function a() {
  return new Error("at a");
}
function b() {
  return a();
}
function c() {
  return b();
}
console.log(a().stack);
console.log(b().stack);
console.log(c().stack);
try {
  null.x;
} catch (e) {
  console.log(e.stack);
}
