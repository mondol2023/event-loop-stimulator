// ||, && and ?? short-circuit and return an operand; ?. short-circuits a whole chain.
function value(label, v) {
  console.log("evaluated", label);
  return v;
}
console.log(0 || "fallback", "" || "fallback", null || undefined, "x" || "y");
console.log(1 && 2, 0 && 2, "" && "no", null && "no", "a" && "b" && "c");
console.log(0 ?? "d", "" ?? "d", false ?? "d", null ?? "d", undefined ?? "d", NaN ?? "d");
console.log(value("a", 0) || value("b", 5));
console.log(value("c", 0) && value("d", 5));
console.log(value("e", 0) ?? value("f", 5));
console.log(value("g", null) ?? value("h", 5));
console.log(null ?? (0 || "grouped"));
console.log((null || undefined) ?? "after or");

const user = {
  name: "Ada",
  address: { city: "London", tags: ["a", "b"] },
  greet() {
    return "hi " + this.name;
  },
  nothing: null,
};
console.log(user?.name, user?.address?.city, user.missing?.city, user.nothing?.city);
console.log(user.address?.tags?.[1], user.address?.tags?.[5], user.missing?.tags?.[0]);
console.log(user.greet?.(), user.nope?.(), user.nothing?.());
let nothing = null;
console.log(nothing?.a.b.c.d, nothing?.[value("skipped", 0)]);
let undef;
console.log(undef?.x, undef?.x.y, undef?.());
console.log(typeof user?.greet, user?.["name"]);
try {
  console.log(user.missing.city);
} catch (e) {
  console.log(e.name + ": " + e.message);
}
try {
  console.log(user.nothing.city);
} catch (e) {
  console.log(e.name + ": " + e.message);
}
try {
  user.nope();
} catch (e) {
  console.log(e.name + ": " + e.message);
}
