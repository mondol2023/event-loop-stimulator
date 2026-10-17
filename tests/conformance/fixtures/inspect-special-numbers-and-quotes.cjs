// util.inspect on -0, NaN, Infinity, quote choice and keys that need quoting.
console.log(-0);
console.log([-0, 0, NaN, Infinity, -Infinity]);
console.log({ a: -0, b: NaN, c: Infinity });
console.log(["it's", 'say "hi"', "both ' and \"", "back`tick'\""]);
console.log({ "a-b": 1, valid_id: 2, 3: 4, "with space": 5, "": 6 });
console.log("top level string is not quoted");
console.log(["nested string is quoted"]);
console.log([undefined, null, true]);
