// Bytecode micro-fixture: try/catch (handler rows, the catch context and what leaves a try block).
function f() {}
function g(x) {}
function plain() { try { f(); } catch (e) { g(e); } }
function noBinding() { try { f(); } catch { g(); } }
function captured() { try { f(); } catch (e) { return () => e; } }
function lexical() { try { f(); } catch (e) { let x = e; g(x); } }
function inLoop() { for (let i = 0; i < 3; i++) { try { if (i) continue; f(); } catch (e) { break; } } }
function returns() { try { return f(); } catch (e) { return e; } }
function nested() { try { try { f(); } catch (a) { g(a); } } catch (b) { g(b); } }
plain(); noBinding(); captured(); lexical(); inLoop(); returns(); nested();
try { f(); } catch (e) { g(e); }
