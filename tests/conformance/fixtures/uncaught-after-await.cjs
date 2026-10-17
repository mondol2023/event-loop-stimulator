// After its first await an async function is resumed from a microtask, so only its own frame is printed.
async function f() {
  console.log("before await");
  await null;
  console.log("after await");
  throw new Error("boom after await");
}
f();
console.log("end of script");
