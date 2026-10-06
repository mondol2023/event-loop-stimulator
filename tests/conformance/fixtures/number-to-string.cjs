// Number::toString: the shortest string that round-trips, with V8's exponent thresholds.
console.log(0.1 + 0.2);
console.log(0.1 * 3);
console.log(1 / 3);
console.log(2 / 3);
console.log(1e21);
console.log(1e21 - 1e5);
console.log(123456789012345680000);
console.log(1e20);
console.log(-1e21);
console.log(1e-6);
console.log(1e-7);
console.log(0.000001234);
console.log(5e-324);
console.log(1.7976931348623157e308);
console.log(2 ** 53);
console.log(2 ** 53 + 1);
console.log(0xff, 0b101, 0o17);
console.log(100, 1.0, 1.5, 0.5e1);
console.log(NaN, Infinity, -Infinity);

// console.log shows -0 as -0, string conversion shows 0.
console.log(-0);
console.log(0 * -1);
console.log([-0, 0]);
console.log("" + -0);
console.log(`${-0}`);
console.log(-0 === 0, 1 / -0, 1 / 0);

console.log("" + 1e21, "" + 1e-7, "" + 0.1, "" + 5e-324);
console.log(0.1 + 0.2 === 0.3, 0.5 + 0.25 === 0.75);
console.log(9007199254740993, 9007199254740992 + 2);
console.log(4294967296 * 4294967296);
console.log(10 / 3, -10 / 3, 10 % 3, -10 % 3, 5.5 % 2);
console.log(7 / 2, Math.floor(7 / 2), Math.trunc(-7 / 2), Math.round(2.5), Math.round(-2.5), Math.round(-0.4));
