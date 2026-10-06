// Own keys come out as integer indexes ascending, then strings in insertion order.
function keys(o) {
  return Object.keys(o).reduce((all, k) => (all === "" ? k : all + " " + k), "");
}

const o = { b: 1, 2: "two", a: 2, 1: "one", 10: "ten", "-1": "negative", "01": "padded", c: 3 };
console.log(keys(o));
console.log(Object.keys({ b: 1, 2: "two", a: 2, 1: "one" }));
console.log({ b: 1, 2: "two", a: 2, 1: "one" });

o.z = 4;
o[0] = "zero";
console.log(keys(o));

// Deleting and re-adding moves a key to the end of the string keys.
delete o.b;
o.b = "back";
console.log(keys(o));

// Keys are strings: 1 and "1" are the same key.
const same = {};
same[1] = "number";
same["1"] = "string";
console.log(Object.keys(same), same);

// Large and non-canonical numeric strings: only canonical array indexes sort first.
const edge = {};
edge["4294967294"] = "max index";
edge["b"] = 1;
edge["1.5"] = "fraction";
edge["2"] = "two";
console.log(keys(edge));

// Keys assigned through a variable keep insertion order among string keys.
const key = "dyn";
const assigned = {};
assigned[key] = 1;
assigned.first = 2;
assigned[1 + 1] = 3;
console.log(Object.keys(assigned), assigned);

console.log(Object.keys({ x: 1, y: 2, z: 3 }).length, Object.keys({}), Object.keys([5, 6]));
