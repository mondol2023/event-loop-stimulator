// Any value can be thrown. Only Error objects carry a stack; an uncaught string prints as the bare value.
try {
  throw { a: 1 };
} catch (e) {
  console.log(typeof e, e, e.stack);
}
try {
  throw 42;
} catch (e) {
  console.log(typeof e, e);
}
try {
  throw null;
} catch (e) {
  console.log(typeof e, e);
}
try {
  throw "caught string";
} catch (e) {
  console.log(typeof e, e);
} finally {
  console.log("finally");
}

function thrower(value) {
  throw value;
}
console.log("about to throw a string");
thrower("str");
console.log("not reached");
