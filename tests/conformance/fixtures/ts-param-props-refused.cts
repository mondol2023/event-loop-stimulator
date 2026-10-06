// A constructor parameter property declares and assigns a field, which needs a transform: Node refuses the file.
class Point {
  constructor(
    private x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}
console.log(new Point(1, 2).sum());
