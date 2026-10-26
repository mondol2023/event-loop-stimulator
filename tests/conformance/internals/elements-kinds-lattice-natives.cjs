// Elements kinds: an array literal of small integers starts PACKED_SMI_ELEMENTS, a double moves it to PACKED_DOUBLE_ELEMENTS and a hole to HOLEY_DOUBLE_ELEMENTS; the transitions only go one way.
const list = [1, 2, 3];
console.log(list);
console.log("probe 1", kind(list));

list.push(4.5);
console.log(list, list.length);
console.log("probe 2", kind(list));

list[6] = 7;
console.log(list, list.length);
console.log("probe 3", kind(list));

// Filling the holes later leaves the array HOLEY: the kind never goes back to packed.
list[4] = 5;
list[5] = 6;
console.log(list, list.length);
console.log("probe 4", kind(list));
console.log(list.map((n) => n * 2));
console.log(Object.keys(list).join());

// Probe helper (natives twin only); function hoisting makes it visible to the probes above.
function kind(array) {
  const holey = %HasHoleyElements(array) ? "HOLEY" : "PACKED";
  if (%HasSmiElements(array)) return holey + "_SMI_ELEMENTS";
  if (%HasDoubleElements(array)) return holey + "_DOUBLE_ELEMENTS";
  if (%HasObjectElements(array)) return holey + "_ELEMENTS";
  if (%HasDictionaryElements(array)) return "DICTIONARY_ELEMENTS";
  return "other";
}
