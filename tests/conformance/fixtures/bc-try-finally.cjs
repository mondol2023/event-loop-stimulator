// Bytecode micro-fixture: try/finally (the token dispatch after the finally block).
function f() {}
function g() {}
function h() {}
function returnAndFall(x) { try { if (x) return 1; f(); } finally { g(); } }
function twoReturns(x) { try { if (x) return 1; return 2; } finally { g(); } }
function loopExits() { for (;;) { try { if (f()) break; if (g()) continue; return 1; } finally { h(); } } }
function nestedReturn() { try { try { return f(); } finally { g(); } } finally { h(); } }
function breakOnly() { while (f()) { try { if (g()) break; } finally { h(); } } }
function inBlockContext() { while (f()) { let c = 1; g(() => c); try { if (h()) break; } finally { f(); } } }
function catchFinally() { try { f(); } catch (e) { g(e); } finally { h(); } }
function finallyOnly() { try { f(); } finally { g(); } }
function throwOnly() { try { throw f(); } finally { g(); } }
function returnInFinally() { try { return f(); } finally { return g(); } }
returnAndFall(0); twoReturns(0); loopExits(); nestedReturn(); breakOnly(); inBlockContext();
catchFinally(); finallyOnly(); returnInFinally();
try { throwOnly(); } catch (x) {}
