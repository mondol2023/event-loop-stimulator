// Bytecode micro-fixture: short-circuit operators, conditionals, typeof, globals and template literals.
// It never calls anything, so the compiled wrapper holds only the instructions under test.
var a = 1, b = 0, s = "s";
var orValue = a || b || s;
var andValue = a && b && s;
var nullish = a ?? b;
var chosen = a ? b : s;
var nested = a ? (b ? 1 : 2) : 3;
var kind = typeof a, missing = typeof notDeclared, isString = typeof s === "string";
var nothing = a == null, defined = a !== undefined, empty = a === null;
var nan = NaN, infinity = Infinity;
globalValue = a;
globalValue += 1;
globalValue++;
a ||= b;
a &&= b;
a ??= b;
var template = `plain`, spliced = `a${a}b${s}c`, wrapped = `${a}`;
var sequence = (a, b);
a, b;
