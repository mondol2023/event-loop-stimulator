// Bytecode micro-fixture: optional member access and optional calls.
var o = { a: { b: 1 }, f() { return 2; }, list: [1] };
var nothing = null;
var k = "a";
console.log(o?.a, o.a?.b, nothing?.a, nothing?.a.b, o?.[k], o.list?.[0], nothing?.[k]);
console.log(o.f?.(), o?.f(), nothing?.f(), o.g?.(), (o?.a).b);
function call(fn, x) {
  return fn?.(x) ?? x?.y;
}
console.log(call(undefined, { y: 3 }), call((v) => v, 4));
