// setInterval repeats until cleared; clearInterval and clearTimeout work from inside the callback or before it fires.
let count = 0;
const first = setInterval(() => {
  count++;
  console.log("first interval", count);
  if (count === 3) {
    clearInterval(first);
    console.log("first interval cleared");
    startSecond();
  }
}, 5);

function startSecond() {
  let n = 0;
  const second = setInterval(() => {
    n++;
    console.log("second interval", n);
    if (n === 2) {
      // clearTimeout clears an interval too: the two share one list of timers.
      clearTimeout(second);
      console.log("second interval cleared with clearTimeout");
      startThird();
    }
  }, 5);
}

function startThird() {
  const cancelled = setTimeout(() => console.log("cancelled timeout never runs"), 5);
  clearTimeout(cancelled);
  const unused = setInterval(() => console.log("cancelled interval never runs"), 5);
  clearInterval(unused);
  clearTimeout(undefined);
  clearInterval(null);
  setTimeout(() => console.log("this timeout runs and ends the program"), 30);
}
