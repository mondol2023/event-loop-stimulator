// Assigning to a const binding throws a TypeError; mutating the value it holds does not.
const answer = 42;
try {
  answer = 43;
} catch (e) {
  console.log(e.name + ": " + e.message);
}
try {
  answer++;
} catch (e) {
  console.log(e.name + ": " + e.message);
}
try {
  answer += 1;
} catch (e) {
  console.log(e.name + ": " + e.message);
}
console.log(answer);

const box = { n: 1 };
box.n = 2;
box.m = 3;
console.log(box);

function reassign() {
  const local = 1;
  local = 2;
  return local;
}
try {
  reassign();
} catch (e) {
  console.log(e.name + ": " + e.message);
}

// A for loop with a const counter throws on the first increment.
try {
  for (const i = 0; i < 3; i++) {
    console.log("iteration", i);
  }
} catch (e) {
  console.log(e.name + ": " + e.message);
}
