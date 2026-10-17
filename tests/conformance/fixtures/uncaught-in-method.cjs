// A method call is printed as Object.m, and the top level as Object.<anonymous>.
const o = {
  m() {
    throw new Error("boom in method");
  },
};
function outer() {
  o.m();
}
console.log("start");
outer();
