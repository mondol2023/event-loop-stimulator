// Bytecode micro-fixture: locals, arithmetic, comparisons, updates and compound assignment. It never
// calls anything, so the compiled wrapper holds only the instructions under test.
var a = 1, b = 2, c;
var big = 100000, neg = -5, half = 0.5, text = "text", flag = true, none = null, nothing = undefined;
var sum = a + b + big;
var mixed = a + (b + big);
var diff = a - 1, prod = 3 * a, quot = a / 2, rest = a % 2, power = a ** 2;
var bits = (a | 4) & (b ^ 1), shifted = a << 2 >> 1 >>> 1, inverted = ~a;
var less = a < b, more = a > b, atMost = a <= b, atLeast = a >= b;
var same = a === b, different = a !== b, loose = a == b, notLoose = a != b;
var negated = !a, minus = -a, plus = +a;
a += 1;
b -= a;
a *= b;
a++;
--b;
c = a++ + b--;
a = b = 3;
