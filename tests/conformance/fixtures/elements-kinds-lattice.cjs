// Elements kinds: an array literal of small integers starts PACKED_SMI_ELEMENTS, a double moves it to PACKED_DOUBLE_ELEMENTS and a hole to HOLEY_DOUBLE_ELEMENTS; the transitions only go one way.
const list = [1, 2, 3];
console.log(list);

list.push(4.5);
console.log(list, list.length);

list[6] = 7;
console.log(list, list.length);

// Filling the holes later leaves the array HOLEY: the kind never goes back to packed.
list[4] = 5;
list[5] = 6;
console.log(list, list.length);
console.log(list.map((n) => n * 2));
console.log(Object.keys(list).join());
