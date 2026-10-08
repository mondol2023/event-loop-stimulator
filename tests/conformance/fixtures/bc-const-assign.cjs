function local(c) {
  const v = 1;
  if (c) { v = 2; v++; v += 1; }
  return v;
}
function captured(c) {
  const q = 1;
  return function () {
    if (c) { q = 3; q = 4; }
    return q;
  };
}
local(0);
captured(0)();
