// Strings are UTF-16 code units; templates convert with ToString, + converts with ToPrimitive.
const name = "world";
const n = 3;
console.log("hello " + name + "!");
console.log(`hello ${name}!`);
console.log(`${n} + ${n} = ${n + n}`);
console.log(`nested ${`inner ${name}`} template`);
console.log(`multi
line`);
console.log(`${null} ${undefined} ${true} ${1.5} ${-0}`);
console.log("tab\there", "newline\\n", 'quote"s', "apostrophe's");
console.log("\x41B\u{43}", "café", "\u{1F600}");
console.log("emoji: 😀 length", "😀".length, "\u{1F600}".length, "é".length);
console.log("abc".length, "".length, "a\nb".length);
console.log("abc"[1], "abc"[5], "😀"[0] === "😀"[1]);
console.log("a" < "b", "a" < "B", "abc" < "abd", "10" < "9", "" < "a");
console.log("a" + 1 + 2, 1 + 2 + "a");

const t = {
  toString() {
    return "T";
  },
  valueOf() {
    return 7;
  },
};
console.log(`${t}`, t + "", "" + t, t * 2);

let order = "";
function mark(label, value) {
  order = order + label;
  return value;
}
console.log(`${mark("a", 1)}${mark("b", 2)}${mark("c", 3)}`, order);
console.log("line one\nline two");
console.log(["it's", 'say "hi"', `both ' and "`, "plain"]);
console.log({ s: "it's", t: 'say "hi"', u: `both ' and "` });
