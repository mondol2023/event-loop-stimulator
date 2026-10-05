import { describe, expect, it } from "vitest";
import { lineColumn } from "./diagnostics";

describe("lineColumn", () => {
  it("starts at line 1, column 0", () => {
    expect(lineColumn("abc", 0)).toEqual({ line: 1, column: 0 });
    expect(lineColumn("abc", 2)).toEqual({ line: 1, column: 2 });
  });

  it("treats \n as a line break", () => {
    expect(lineColumn("a\nb", 2)).toEqual({ line: 2, column: 0 });
  });

  it("treats \r\n as a single line break", () => {
    expect(lineColumn("a\r\nb", 3)).toEqual({ line: 2, column: 0 });
    expect(lineColumn("a\r\nb", 2)).toEqual({ line: 1, column: 2 });
  });

  it("treats a lone \r as a line break", () => {
    expect(lineColumn("a\nb\rc", 4)).toEqual({ line: 3, column: 0 });
  });

  it("clamps offsets past the end of the source", () => {
    expect(lineColumn("ab\ncd", 99)).toEqual({ line: 2, column: 2 });
  });
});
