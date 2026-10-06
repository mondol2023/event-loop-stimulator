// Assigning to length truncates or extends (with holes); assigning past the end grows length.
const a = [1, 2, 3, 4, 5];
a.length = 2;
console.log(a, a.length, a[2]);

a.length = 5;
console.log(a, a.length);

a[9] = "far";
console.log(a, a.length);

a.length = 0;
console.log(a, a.length);

const b = [1, 2, 3];
b.length = 3;
console.log(b);
b.push("p");
console.log(b, b.length);

// push after truncation appends at the new length.
const c = [1, 2, 3, 4];
c.length = 1;
c.push("again");
console.log(c);

// length is writable but must be a valid array length.
try {
  c.length = -1;
} catch (e) {
  console.log(e.name + ": " + e.message);
}
try {
  c.length = 1.5;
} catch (e) {
  console.log(e.name + ": " + e.message);
}
console.log(c.length);

// Setting length to a numeric string works; the index of an element is not the same as length.
const d = [1, 2, 3];
d.length = "1";
console.log(d);
d[5] = 6;
console.log(d.length, Object.keys(d));
