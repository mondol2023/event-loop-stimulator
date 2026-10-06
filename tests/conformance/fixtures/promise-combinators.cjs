// Promise.all, race and allSettled: result order, first-settled-wins, and non-promise inputs.
// Timers are 20+ ms apart so the order they settle in is stable.
const later = (value, ms) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const failLater = (reason, ms) => new Promise((resolve, reject) => setTimeout(() => reject(reason), ms));

async function main() {
  console.log("all:", await Promise.all([1, Promise.resolve(2), later(3, 40), later(4, 20)]));
  console.log("all of nothing:", await Promise.all([]));
  try {
    await Promise.all([later("slow", 60), failLater("first failure", 20), failLater("second failure", 40)]);
  } catch (reason) {
    console.log("all rejects with the first rejection:", reason);
  }

  console.log("race:", await Promise.race([later("slow", 60), later("fast", 20), later("medium", 40)]));
  console.log("race with a plain value:", await Promise.race([later("timer", 20), "immediate"]));
  try {
    await Promise.race([later("slow", 60), failLater("fast failure", 20)]);
  } catch (reason) {
    console.log("race rejects when a rejection is first:", reason);
  }

  console.log("allSettled:", await Promise.allSettled([1, Promise.reject("no"), later("yes", 20), failLater(0, 40)]));
  console.log("allSettled of nothing:", await Promise.allSettled([]));
}

main().then(() => {
  // Result order follows the input order, not the settle order.
  Promise.all([later("third", 60), later("first", 20), later("second", 40)]).then((all) => console.log("ordered:", all));
});

// The input is read synchronously: values and already-settled promises resolve in microtask turns.
Promise.all([1, 2]).then((v) => console.log("sync inputs:", v));
Promise.allSettled([Promise.resolve("x")]).then((v) => console.log("settled sync:", v));
Promise.race([1, 2]).then((v) => console.log("race of values:", v));
