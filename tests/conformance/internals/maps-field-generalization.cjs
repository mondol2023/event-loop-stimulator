// Field representation generalizes in place (Smi -> Double -> Tagged); the probes show whether the Map is shared with a sibling.
const a = { f: 1 };
const b = { f: 2 };
console.log("smi siblings:", %HaveSameMap(a, b), %HasFastProperties(a));
a.f = 1.5;
console.log("a is double:", %HaveSameMap(a, b), %HasFastProperties(a));
a.f = "text";
console.log("a is tagged:", %HaveSameMap(a, b), %HasFastProperties(a));
const c = { f: 3 };
console.log("fresh sibling:", %HaveSameMap(a, c), %HaveSameMap(b, c));
b.f = {};
console.log("b holds an object:", %HaveSameMap(a, b), %HaveSameMap(b, c));
