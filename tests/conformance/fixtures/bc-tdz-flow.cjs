function ifElse(c) {
  if (c) {
    if (c > 1) { z; } else { z; }
    z;
  }
  let z = 1;
  return z;
}
function oneArm(c) {
  if (c) {
    if (c > 1) { z; }
    z;
  }
  let z = 1;
  return z;
}
function loops(c) {
  if (c) {
    z;
    while (c) { z; c = 0; }
    for (; c; z) { z; c = 0; }
    z;
  }
  let z = 1;
  return z;
}
function afterLoop(c) {
  if (c) {
    while (c) { z; c = 0; }
    for (; c; z) { c = 0; }
    z;
  }
  let z = 1;
  return z;
}
function logical(c) {
  if (c) {
    c && z;
    z;
    c ? z : 0;
    z;
  }
  let z = 1;
  return z;
}
ifElse(0);
oneArm(0);
loops(0);
afterLoop(0);
logical(0);
