// Hidden classes: objects that gain the same properties in the same order share one Map (shape); a different order forks the transition tree into a different Map.
function Point(x, y) {
  this.x = x;
  this.y = y;
}

const a = new Point(1, 2);
const b = new Point(3, 4);
const sameOrder = { x: 5, y: 6 };
const otherOrder = { y: 7, x: 8 };

console.log(a, b);
console.log(sameOrder, otherOrder);
console.log(Object.keys(a).join(), Object.keys(b).join());
console.log(Object.keys(sameOrder).join(), Object.keys(otherOrder).join());

// Same keys, same order: one shape. Same keys, different order: two shapes.
const keyOrder = (o) => Object.keys(o).join(",");
console.log(keyOrder(a) === keyOrder(b));
console.log(keyOrder(sameOrder) === keyOrder(otherOrder));

// Adding a property after construction walks one more transition; only objects that did the same walk share the shape.
b.z = 9;
console.log(a, b);
console.log(keyOrder(a) === keyOrder(b));
