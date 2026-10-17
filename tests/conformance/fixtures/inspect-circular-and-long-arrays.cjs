// Circular references, more than 6 numbers per line, and more than 100 array items.
const a = { name: "a" };
a.self = a;
console.log(a);
const b = { x: 1 };
const c = { b: b };
b.c = c;
console.log(b);
console.log([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
const big = [];
let i = 0;
while (i < 120) {
  big.push(i);
  i++;
}
console.log(big);
