import { describe, expect, it, vi } from "vitest";
import { acquire, release } from "./board/boardResources";

function resource() {
  return { dispose: vi.fn<() => void>() };
}

describe("boardResources", () => {
  it("shares one object per key and disposes it on the last release only", () => {
    const create = vi.fn(resource);
    const a = acquire("shared-geometry", create);
    const b = acquire("shared-geometry", create);
    expect(b).toBe(a);
    expect(create).toHaveBeenCalledTimes(1);

    release("shared-geometry");
    expect(a.dispose).not.toHaveBeenCalled();
    release("shared-geometry");
    expect(a.dispose).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh object when a key is acquired again after its last release", () => {
    const first = acquire("reacquired", resource);
    release("reacquired");
    const second = acquire("reacquired", resource);
    expect(second).not.toBe(first);
    expect(second.dispose).not.toHaveBeenCalled();
    release("reacquired");
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(first.dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps keys independent, and ignores a release for a key nobody holds", () => {
    const a = acquire("key-a", resource);
    const b = acquire("key-b", resource);
    release("key-a");
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).not.toHaveBeenCalled();
    expect(() => release("never-acquired")).not.toThrow();
    release("key-b");
    expect(() => release("key-b")).not.toThrow();
    expect(b.dispose).toHaveBeenCalledTimes(1);
  });
});
