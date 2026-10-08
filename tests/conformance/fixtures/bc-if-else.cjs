// Bytecode micro-fixture: if / else, constant conditions and return / throw at the top level.
var a = 1, b = 2, c = 0;
if (a) { c = 1; } else { c = 2; }
if (a && b) c = 4;
else if (a || b) c = 5;
if (true) { c = 1; }
if (false) { c = 2; } else { c = 3; }
if (a > b) c = 6;
if (c) return;
if (b) { return c + 1; } else { throw 7; }
