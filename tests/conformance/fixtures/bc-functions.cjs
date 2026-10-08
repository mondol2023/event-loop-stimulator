// Bytecode micro-fixture: function declarations, expressions and arrows, parameters and plain calls.
function add(a, b) { return a + b; }
var f = function (x) { return x; };
var g = (y) => y + 1;
function none() {}
function three(a, b, c) { return a + b + c; }
function swap(a, b) { a = b; return a; }
function early(n) { if (n) return 1; return; }
add(1, 2);
f(3);
g(4);
none();
three(1, 2, 3);
swap(4, 5);
early(0);
