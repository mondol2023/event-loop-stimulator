// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createPlaygroundStore } from "../store/playgroundStore";
import { fixtureRun } from "../test/fixtureTimeline";
import { isEditableTarget, type ShortcutAction, shortcutFor } from "./shortcuts";
import { useShortcuts } from "./useShortcuts";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const plain = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, editable: false };
const KEYS = [" ", "ArrowLeft", "ArrowRight", "Home", "End"];

describe("shortcutFor", () => {
  it.each<[string, boolean, ShortcutAction]>([
    [" ", false, "toggle-play"],
    ["ArrowLeft", false, "step-back"],
    ["ArrowRight", false, "step-forward"],
    ["ArrowLeft", true, "boundary-back"],
    ["ArrowRight", true, "boundary-forward"],
    ["Home", false, "first"],
    ["End", false, "last"],
  ])("maps %j (shift %s) to %s", (key, shiftKey, action) => {
    expect(shortcutFor({ ...plain, key, shiftKey })).toBe(action);
  });

  it("returns null for unmapped keys", () => {
    expect(shortcutFor({ ...plain, key: "a" })).toBeNull();
  });

  it("returns null for every key while the target is editable", () => {
    for (const key of KEYS) expect(shortcutFor({ ...plain, key, editable: true })).toBeNull();
  });

  it("returns null when Ctrl, Meta or Alt is held", () => {
    expect(shortcutFor({ ...plain, key: "ArrowLeft", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ ...plain, key: " ", metaKey: true })).toBeNull();
    expect(shortcutFor({ ...plain, key: "End", altKey: true })).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("is true for a textarea and a span inside a contenteditable div", () => {
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    const span = document.createElement("span");
    div.append(span);
    document.body.append(div);
    expect(isEditableTarget(span)).toBe(true);
  });

  it("is true for input and select, false for a button, and safe for non-elements", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });
});

describe("useShortcuts", () => {
  function setup() {
    const { compiled, simulated } = fixtureRun("nexttick-vs-promise");
    const store = createPlaygroundStore();
    store.getState().applyPipelineEvent({ kind: "response", response: compiled });
    store.getState().applyPipelineEvent({ kind: "response", response: simulated });
    return store;
  }
  const press = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it("toggles on body but not on a textarea, and stops after unmount", () => {
    const store = setup();
    const view = renderHook(() => useShortcuts(store));
    const area = document.createElement("textarea");
    document.body.append(area);

    const typed = press(area, { key: " " });
    expect(store.getState().playback.isPlaying).toBe(false);
    expect(typed.defaultPrevented).toBe(false);

    const handled = press(document.body, { key: " " });
    expect(store.getState().playback.isPlaying).toBe(true);
    expect(handled.defaultPrevented).toBe(true);

    view.unmount();
    press(document.body, { key: " " });
    expect(store.getState().playback.isPlaying).toBe(true);
  });

  it("steps, seeks to the ends, and ignores Ctrl chords", () => {
    const store = setup();
    renderHook(() => useShortcuts(store));
    const { length } = store.getState().playback;
    press(document.body, { key: "End" });
    expect(store.getState().playback.index).toBe(length - 1);
    press(document.body, { key: "ArrowLeft" });
    expect(store.getState().playback.index).toBe(length - 2);
    const chord = press(document.body, { key: "Home", ctrlKey: true });
    expect(chord.defaultPrevented).toBe(false);
    press(document.body, { key: "Home" });
    expect(store.getState().playback.index).toBe(0);
  });

  it("does not throw on Home and End with an empty timeline", () => {
    const store = createPlaygroundStore();
    renderHook(() => useShortcuts(store));
    expect(() => {
      press(document.body, { key: "Home" });
      press(document.body, { key: "End" });
    }).not.toThrow();
    expect(store.getState().playback.index).toBe(0);
  });
});
