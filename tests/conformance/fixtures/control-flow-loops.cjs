// if/else, for, while, break and continue, and a top-level return that ends the script (not the process).
const limit = 3;

for (let i = 0; i < limit; i++) {
  if (i === 1) {
    console.log("skip", i);
    continue;
  }
  console.log("for", i);
}

let n = 10;
while (n > 0) {
  n -= 4;
  if (n < 3) {
    break;
  }
  console.log("while", n);
}
console.log("after while", n);

// Nested loops: break and continue only affect the innermost loop.
for (let row = 0; row < 3; row++) {
  let line = "";
  for (let col = 0; col < 5; col++) {
    if (col === row) {
      continue;
    }
    if (col > 3) {
      break;
    }
    line = line + col;
  }
  console.log("row", row, "->", line);
}

// A var counter survives the loop; the condition runs once more than the body.
var checks = 0;
function below(bound) {
  checks++;
  return j < bound;
}
for (var j = 0; below(2); j++) {}
console.log("j", j, "checks", checks);

var k = 0;
for (;;) {
  k++;
  if (k >= 3) break;
}
console.log("k", k);

let kind;
const score = 72;
if (score > 90) {
  kind = "A";
} else if (score > 70) {
  kind = "B";
} else {
  kind = "C";
}
console.log("kind", kind, score > 50 ? "pass" : "fail");

setTimeout(() => {
  console.log("a timer still runs after a top-level return");
}, 0);

if (limit > 2) {
  console.log("returning from the module");
  return;
}
console.log("not reached");
