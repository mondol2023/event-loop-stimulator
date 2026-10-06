// V8 internals probe (run with --allow-natives-syntax): objects share a Map (hidden class) when they were built
// with the same properties added in the same order. %HaveSameMap compares the Maps of two objects.
const a = { x: 1, y: 2 };
const b = { x: 3, y: 4 };
const c = { y: 2, x: 1 };
console.log("literals, same order:", %HaveSameMap(a, b));
console.log("literals, other order:", %HaveSameMap(a, c));

function make(x, y) {
  const o = {};
  o.x = x;
  o.y = y;
  return o;
}
const d = make(1, 2);
const e = make(3, 4);
console.log("same transitions:", %HaveSameMap(d, e));
console.log("literal vs transitions:", %HaveSameMap(a, d));

function makeReversed(x, y) {
  const o = {};
  o.y = y;
  o.x = x;
  return o;
}
console.log("other transition order:", %HaveSameMap(d, makeReversed(1, 2)));

const f = { x: 1, y: 2 };
f.z = 3;
console.log("after adding a property:", %HaveSameMap(a, f));
const g = { x: 1, y: 2 };
g.z = 3;
console.log("same added property:", %HaveSameMap(f, g));

// Values do not matter, only the property names and their order.
const h = { x: "string", y: [1] };
console.log("different value types:", %HaveSameMap(a, h));

// Deleting a property leaves the transition tree: the object no longer has the shared Map.
const i = { x: 1, y: 2 };
i.z = 3;
delete i.z;
console.log("delete the last property:", %HaveSameMap(a, i), %HasFastProperties(i));
const j = { x: 1, y: 2, z: 3 };
delete j.x;
console.log("delete an earlier property:", %HaveSameMap(f, j), %HasFastProperties(j));

// Arrays and objects have different Maps.
console.log("array vs object:", %HaveSameMap([], {}), %HaveSameMap([1], [2]));
