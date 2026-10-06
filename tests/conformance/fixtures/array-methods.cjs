// push, pop, length, map, filter, forEach and reduce, including the callback arguments and the empty cases.
const numbers = [3, 1, 4, 1, 5];
console.log(numbers, numbers.length);
console.log(numbers.push(9), numbers.push(2, 6), numbers);
console.log(numbers.pop(), numbers.pop(), numbers);

const empty = [];
console.log(empty.pop(), empty.length, empty);

console.log(numbers.map((n) => n * 2));
console.log(numbers.filter((n) => n > 2));
console.log(numbers.reduce((sum, n) => sum + n, 0));
console.log(numbers.reduce((sum, n) => sum + n));
console.log(numbers.reduce((max, n) => (n > max ? n : max), -Infinity));
console.log(numbers.filter((n) => n > 100));

// Callbacks receive (element, index, array); reduce receives (accumulator, element, index, array).
numbers.forEach((n, i, all) => {
  if (i < 2) console.log("forEach", n, i, all === numbers);
});
console.log(numbers.map((n, i) => n + i));
console.log(numbers.reduce((acc, n, i) => acc + n * i, 0));

// forEach returns undefined; map returns a new array of the same length.
const doubled = numbers.map((n) => n * 2);
console.log(numbers.forEach((n) => n), doubled === numbers, doubled.length === numbers.length);

// Callbacks that return nothing.
console.log(numbers.map(() => {}));
console.log([1, 2, 3].filter(() => 1), [1, 2, 3].filter(() => 0));

// reduce on an empty array: the initial value is returned, or a TypeError is thrown.
console.log(empty.reduce((a, b) => a + b, "initial"));
try {
  empty.reduce((a, b) => a + b);
} catch (e) {
  console.log(e.name + ": " + e.message);
}
console.log([7].reduce((a, b) => a + b));

// map and forEach skip holes; filter and reduce skip them too.
const holey = [1, , 3];
console.log(holey.map((n) => n * 10));
let visited = 0;
holey.forEach(() => {
  visited++;
});
console.log(visited, holey.filter(() => true), holey.reduce((a, b) => a + b));

// Mutation during iteration: the length is read once, new elements are not visited.
const growing = [1, 2];
growing.forEach((n) => {
  if (growing.length < 5) growing.push(n * 10);
});
console.log(growing);

try {
  numbers.map(1);
} catch (e) {
  console.log(e.name + ": " + e.message);
}
console.log([[1, 2], [3]].map((a) => a.length), [1, [2, [3]]]);
