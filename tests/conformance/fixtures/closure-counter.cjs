// Closures keep their defining scope alive; each call to the factory makes a fresh scope.
function makeCounter(start) {
  let count = start;
  return {
    inc() {
      count++;
      return count;
    },
    add(by) {
      count += by;
      return count;
    },
    get() {
      return count;
    },
  };
}

const a = makeCounter(0);
const b = makeCounter(100);
console.log(a.inc(), a.inc(), a.add(10), a.get());
console.log(b.inc(), b.get());
console.log(a.get(), b.get());

function makeAdder(x) {
  return (y) => x + y;
}
const add5 = makeAdder(5);
const add10 = makeAdder(10);
console.log(add5(1), add10(1), add5(add10(1)));

// Two closures over the same variable see each other's writes.
function pair() {
  let shared = 0;
  return [() => shared, (v) => (shared = v)];
}
const both = pair();
console.log(both[0]());
both[1](7);
console.log(both[0]());

// An immediately invoked function keeps a private variable.
const next = (function () {
  let id = 0;
  return function () {
    id = id + 1;
    return "id-" + id;
  };
})();
console.log(next(), next(), next());

// A closure sees later assignments to a var in its scope.
function late() {
  const read = () => value;
  var value = "assigned after the closure was created";
  return read();
}
console.log(late());

// Inner functions capture parameters, and shadowing hides the outer binding.
function outer(x) {
  function inner(x) {
    return x * 2;
  }
  return [inner(x + 1), x];
}
console.log(outer(3));
