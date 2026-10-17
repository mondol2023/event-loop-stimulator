// util.formatWithOptions directives: %s %d %i %f %c %%, a lone %, extra and missing arguments.
console.log("%s is %d", "x", 1.5);
console.log("%i and %f", 42.9, "3.5abc");
console.log("%c styled", "color:red");
console.log("100%", 5);
console.log("%");
console.log("a %% b");
console.log("%s", "one", "two", 3);
console.log("%s %s", "only one");
console.log("%d", "abc");
console.log("%s", null, undefined);
console.log("%s", 12, true);
console.log("%d", -0);
console.log("no directives", 1, "two");
