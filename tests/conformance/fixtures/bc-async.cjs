// Bytecode micro-fixture: async functions (the generator prologue and jump table, the _AsyncFunction* intrinsics, suspend points, and what a return or a throw does to the promise).
function sink(x) {}
async function noAwait(a) { return a; }
async function empty() {}
async function oneAwait(a) { const x = await a; return x; }
async function twoAwaits(g, y) { g(await 1, await y); const z = 1 + await y; }
async function captured(p) { let a = 1; await p; return () => a + p; }
async function returnsAwait(p) { return await p; }
async function guarded(p) { try { await p; } catch (e) { sink(e); } finally { sink(); } return await p; }
async function throws(p) { if (p) throw p; await p; }
const arrow = async (x) => (await x) + 1;
const block = async () => { await null; };
const expression = async function named(p) { await p; return named; };
const methods = { async m(p) { await p; } };
noAwait(1); empty(); oneAwait(1); twoAwaits(sink, 1); captured(1); returnsAwait(1); guarded(1); throws(0);
arrow(1); block(); expression(1); methods.m(1);
