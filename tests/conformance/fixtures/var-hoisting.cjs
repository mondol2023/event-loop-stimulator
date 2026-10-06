// var and function declarations are hoisted; the declaration moves, not the assignment.
console.log(typeof hoisted, hoisted);
var hoisted = "assigned";
console.log(typeof hoisted, hoisted);

console.log(declared());
function declared() {
  return "function declarations hoist with their bodies";
}

// A function declaration wins over a bare var at hoisting time; the assignment then replaces it.
console.log(typeof both);
var both = 1;
function both() {}
console.log(typeof both);

function scope() {
  console.log(inner);
  if (hoisted) {
    var inner = "a block does not scope var";
  }
  console.log(inner);
  for (var i = 0; i < 2; i++) {}
  console.log(i);
}
scope();

var twice = 1;
var twice = 2;
console.log(twice);

function shadow() {
  var hoisted = "local";
  return hoisted;
}
console.log(shadow(), hoisted);

// A parameter and a var with the same name share one binding.
function paramAndVar(p) {
  var p;
  console.log(p);
  var p = "reassigned";
  return p;
}
console.log(paramAndVar("argument"));
