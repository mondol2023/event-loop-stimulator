// Bytecode micro-fixture: break and continue.
var a = 1, b = 20, c = 0;
while (a < b) { a = a + 1; if (a == 5) continue; if (a == 9) break; }
for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j == 1) continue; if (i == 2) break; c = c + 1; } }
