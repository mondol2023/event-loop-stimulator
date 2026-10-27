type Disposable = { dispose(): void };

type Entry = { value: Disposable; refs: number };

const entries = new Map<string, Entry>();

/** The shared object for `key`, created by `create` on the first acquire; each acquire must be paired with one release. */
export function acquire<T extends Disposable>(key: string, create: () => T): T {
  const held = entries.get(key);
  if (held) {
    held.refs += 1;
    // The key names one kind of object, so the held value is the T that `create` built.
    return held.value as T;
  }
  const value = create();
  entries.set(key, { value, refs: 1 });
  return value;
}

/** Drops one reference; the last release disposes the object and forgets the key. */
export function release(key: string): void {
  const held = entries.get(key);
  if (!held) return;
  held.refs -= 1;
  if (held.refs > 0) return;
  entries.delete(key);
  held.value.dispose();
}
