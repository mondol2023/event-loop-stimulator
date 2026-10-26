import { describe, expect, it } from "vitest";
import { CacheModel } from "./cacheModel";

const line = (n: number): bigint => BigInt(n) * 64n;

describe("CacheModel", () => {
  it("serves the first access from RAM and a repeat from L1", () => {
    const cache = new CacheModel();
    expect(cache.access(line(0))).toBe("ram");
    expect(cache.access(line(0))).toBe("l1");
  });

  it("treats every byte of a 64-byte line as the same line", () => {
    const cache = new CacheModel();
    cache.access(0x1000n);
    expect(cache.access(0x103fn)).toBe("l1");
    expect(cache.access(0x1040n)).toBe("ram");
  });

  it("pushes the oldest line from L1 to L2 after 9 distinct lines", () => {
    const cache = new CacheModel();
    for (let i = 0; i < 9; i++) cache.access(line(i));
    expect(cache.access(line(0))).toBe("l2");
  });

  it("drops a line from both levels after 41 distinct lines", () => {
    const cache = new CacheModel();
    for (let i = 0; i < 41; i++) cache.access(line(i));
    expect(cache.access(line(0))).toBe("ram");
  });

  it("is least-recently-used: a touch keeps a line in L1", () => {
    const cache = new CacheModel();
    for (let i = 0; i < 8; i++) cache.access(line(i));
    cache.access(line(0));
    cache.access(line(8));
    expect(cache.access(line(0))).toBe("l1");
    expect(cache.access(line(1))).toBe("l2");
  });

  it("lists the resident line tags oldest first, L1 within L2", () => {
    const cache = new CacheModel();
    for (let i = 0; i < 10; i++) cache.access(line(i));
    expect(cache.l1()).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(cache.l2()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (let i = 10; i < 40; i++) cache.access(line(i));
    expect(cache.l2()).toHaveLength(32);
    expect(cache.l2()[0]).toBe(8);
  });
});
