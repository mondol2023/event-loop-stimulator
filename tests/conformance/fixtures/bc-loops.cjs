// Bytecode micro-fixture: while and for, constant conditions, nested loops and loop depth.
var a = 1, b = 3, c = 0;
while (a < 5) { a = a + 1; }
for (var i = 0; i < 3; i++) { c = c + i; }
for (let j = 0, m = 5; j < m; j += 2) { c = j; }
while (false) { a = 3; }
while (b) { while (c < 3) { c = c + 1; } b = b - 1; }
while (true) { a = a + 1; if (a > 40) break; }
for (;;) { if (a > 50) break; a = a + 1; }
