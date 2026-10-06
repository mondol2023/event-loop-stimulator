// Recursion, including mutual recursion, and the point where factorial leaves exact integers behind.
function factorial(n) {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}
console.log(factorial(0), factorial(1), factorial(5), factorial(10));
console.log(factorial(18));
console.log(factorial(20));
console.log(factorial(21));
console.log(factorial(25));

function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
console.log(fib(1), fib(2), fib(10), fib(15));

function isEven(n) {
  return n === 0 ? true : isOdd(n - 1);
}
function isOdd(n) {
  return n === 0 ? false : isEven(n - 1);
}
console.log(isEven(10), isOdd(10), isEven(7), isOdd(7));

const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
console.log(fact(6));

// A named function expression can call itself by its own name, even when the outer variable is reassigned.
let counter = function count(n) {
  return n === 0 ? "done" : count(n - 1);
};
const saved = counter;
counter = null;
console.log(saved(5));

function sumTo(n, acc) {
  return n === 0 ? acc : sumTo(n - 1, acc + n);
}
console.log(sumTo(30, 0));

function depth(n) {
  return n === 0 ? 0 : 1 + depth(n - 1);
}
console.log(depth(40));
