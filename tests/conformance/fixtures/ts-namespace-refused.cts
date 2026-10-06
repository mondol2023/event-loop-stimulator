// A namespace with runtime members cannot be erased either: Node refuses the file.
namespace Utils {
  export const answer = 42;
  export function double(n: number): number {
    return n * 2;
  }
}
console.log(Utils.answer, Utils.double(4));
