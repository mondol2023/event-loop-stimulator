// An uncaught ReferenceError for a name that is not declared anywhere.
function useMissing() {
  return missingVariable + 1;
}
console.log("before");
console.log(useMissing());
console.log("not reached");
