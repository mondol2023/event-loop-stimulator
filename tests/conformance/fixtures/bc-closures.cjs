function outer() {
  var x = 1;
  function mid() {
    var y = 2;
    function inner() { return y; }
    function inner2() { return x; }
    return x + y + inner() + inner2();
  }
  function reader() { return x; }
  return mid() + reader();
}
outer();
function counter(start) {
  var n = start;
  var m = 1;
  return function () { n = n + 1; return n + m; };
}
var c = counter(0);
c();
var top = 5;
function readTop() { return top; }
readTop();
