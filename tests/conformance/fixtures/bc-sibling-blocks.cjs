// V8 hands out stack registers to sibling scopes last to first.
function sib() {
  { let a = 1; a = a + 1; }
  { let b = 2; b = b + 1; }
  let top = 3;
  return top;
}
sib();
function nestedSib() {
  let x = 1;
  { let y = 2; { let z = 3; z = z + 1; } let w = 4; w = w + y; }
  { let v = 5; v = v + x; }
}
nestedSib();
