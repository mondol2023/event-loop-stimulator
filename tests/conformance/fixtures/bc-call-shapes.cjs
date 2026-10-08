// Bytecode micro-fixture: call argument counts and callees that are not plain locals.
var one = function (a) { return a; };
var seven = function (a) { return a; };
function declared() { return 1; }
declared();
declared(1);
declared(1, 2);
declared(1, 2, 3);
declared(1, 2, 3, 4);
one(one(1));
one(1 + declared());
seven(1, 2, 3, 4, 5, 6, 7);
String(1);
(function () { return 2; })();
((a) => a)(3);
