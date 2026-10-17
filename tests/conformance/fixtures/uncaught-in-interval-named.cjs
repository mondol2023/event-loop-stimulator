// A named function in setInterval is printed as Timeout.tick [as _onTimeout].
let count = 0;
function tick() {
  count++;
  console.log("tick", count);
  if (count === 3) {
    throw new Error("boom in interval");
  }
}
setInterval(tick, 10);
console.log("end of script");
