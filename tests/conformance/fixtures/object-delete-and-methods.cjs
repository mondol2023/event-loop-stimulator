// Property get/set/delete, shorthand properties, methods and this.
const x = 1;
const y = 2;
const point = {
  x,
  y,
  describe() {
    return "(" + this.x + ", " + this.y + ")";
  },
  moveBy(dx, dy) {
    this.x += dx;
    this.y += dy;
    return this;
  },
};
console.log(point.describe());
console.log(point.moveBy(1, 2).moveBy(10, 20).describe());
console.log(point);

// delete returns true, also for a property that is not there.
console.log(delete point.x, delete point.nothing, point.x, point);
console.log(point.describe());

point.x = "back";
point["y"] = "also";
point.z = 3;
console.log(point.describe(), Object.keys(point));
console.log(delete point.describe, Object.keys(point), point.describe);
try {
  point.describe();
} catch (e) {
  console.log(e.name + ": " + e.message);
}

// Reading a missing property is undefined; reading through undefined throws.
console.log(point.missing, point.missing === undefined);
try {
  console.log(point.missing.deeper);
} catch (e) {
  console.log(e.name + ": " + e.message);
}

// Methods mutate the object they are called on.
const counter = {
  n: 0,
  inc() {
    this.n = this.n + 1;
    return this.n;
  },
};
console.log(counter.inc(), counter.inc());

// Objects are references; equality is identity.
const alias = counter;
alias.n = 100;
console.log(counter.n, alias === counter, { a: 1 } === { a: 1 });

// Properties added in a different order print in insertion order.
const first = {};
first.b = 1;
first.a = 2;
const second = { a: 2, b: 1 };
console.log(first, second, Object.keys(first), Object.keys(second));

// Nested updates and an arrow function that does not bind this.
const config = { nested: { level: 1 }, list: [1, 2] };
config.nested.level++;
config.list.push(3);
config.nested.added = true;
console.log(config);
const arrowHolder = { value: 1, read: () => typeof this };
console.log(arrowHolder.read());
