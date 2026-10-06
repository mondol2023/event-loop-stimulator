// console.log writes to stdout; console.error and console.warn write to stderr. Both format the same way.
console.log("to stdout", 1);
console.error("to stderr", 2);
console.warn("warn also goes to stderr", { w: true });
console.error({ nested: { deep: { deeper: { deepest: 1 } } } });
console.warn([1, 2, 3], "after", null);
console.log("stdout again", [undefined, null]);
console.error();
console.warn("");
console.error("multi\nline", "second argument");
console.log();
console.log("");
console.error("last on stderr");
console.log("last on stdout");
