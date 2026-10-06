// Strip-only mode cannot erase an enum (it has a runtime representation): Node refuses the file.
enum Color {
  Red,
  Green,
  Blue,
}
console.log(Color.Green, Color[0]);
