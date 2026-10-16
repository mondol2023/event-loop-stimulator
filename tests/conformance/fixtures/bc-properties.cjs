// Bytecode micro-fixture: named and keyed property loads and stores, compound assignment and update on members.
var o = { a: 1, b: { c: 2 }, n: 0 };
var k = "a";
console.log(o.a, o[k], o["a"], o[0], o.b.c);
o.a = 3;
o[k] = 4;
o["x"] = 5;
o[1] = 6;
o.b.c = o.a;
var chained = (o.y = 7);
function update(obj, key) {
  obj.count = obj.count + 1;
  obj[key] += 2;
  obj.n++;
  ++obj[key];
  const before = obj.n--;
  obj.b.c *= 3;
  return before + obj[key] + obj.count;
}
console.log(update({ count: 0, n: 0, z: 1, b: { c: 1 } }, "z"), chained, o);
