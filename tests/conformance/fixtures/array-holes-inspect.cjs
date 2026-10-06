// Holes are absent indexes, not undefined; util.inspect prints runs of them as "<N empty item(s)>".
console.log([, 1]);
console.log([1, , 3]);
console.log([, ,]);
console.log([1, , , 4, , ]);
console.log([undefined, , undefined]);

const grown = [];
grown[3] = "x";
console.log(grown, grown.length);
grown[0] = "w";
console.log(grown);

// A hole is skipped by iteration methods, an explicit undefined is not.
const withUndefined = [undefined, undefined];
const withHoles = [, ,];
console.log(withUndefined.length, withHoles.length);
console.log(withUndefined.map(() => 1), withHoles.map(() => 1));
console.log(Object.keys(withUndefined), Object.keys(withHoles), Object.keys([1, , 3]));
console.log([1, , 3][1], withHoles[0], withHoles[5]);

// Filling a hole makes the array dense again; deleting makes a hole.
const filled = [1, , 3];
filled[1] = 2;
console.log(filled);
delete filled[0];
console.log(filled, filled.length);
