// Bytecode micro-fixture: nested loops that start at the same offset share one JumpLoop.
var a = 1, b = 0;
for (;;) { for (;;) { b = b + 1; if (b > 3) break; } break; }
for (;;) { for (;; b = b + 1) { if (a) break; } break; }
while (true) { while (true) { a = a + 1; if (a > 9) break; } if (a) break; }
