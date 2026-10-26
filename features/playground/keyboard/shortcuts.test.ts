// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createPlaygroundStore } from "../store/playgroundStore";
import { fixtureRun } from "../test/fixtureTimeline";
import { isActivatableTarget, isEditableTarget, type ShortcutAction, shortcutFor } from "./shortcuts";
import { useShortcuts } from "./useShortcuts";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const plain = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, editable: false, activatable: false };
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

  it("swallows a held Space without toggling, and lets a held arrow keep stepping", () => {
    expect(shortcutFor({ ...plain, key: " ", repeat: true })).toBe("swallow");
    expect(shortcutFor({ ...plain, key: "ArrowRight", repeat: true })).toBe("step-forward");
  });

  it("leaves Space to an activatable target but keeps the other keys", () => {
    expect(shortcutFor({ ...plain, key: " ", activatable: true })).toBeNull();
    expect(shortcutFor({ ...plain, key: "ArrowLeft", activatable: true })).toBe("step-back");
    expect(shortcutFor({ ...plain, key: "End", activatable: true })).toBe("last");
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

  it("is true for widgets that use the arrow keys themselves", () => {
    for (const role of ["slider", "separator", "tab", "listbox", "menuitem"]) {
      const el = document.createElement("div");
      el.setAttribute("role", role);
      expect(isEditableTarget(el)).toBe(true);
    }
  });
});

describe("isActivatableTarget", () => {
  it("is true for a button and a role=button, false for a link and plain content", () => {
    expect(isActivatableTarget(document.createElement("button"))).toBe(true);
    const link = document.createElement("a");
    link.setAttribute("href", "/x");
    expect(isActivatableTarget(link)).toBe(false);
    const div = document.createElement("div");
    div.setAttribute("role", "button");
    expect(isActivatableTarget(div)).toBe(true);
    expect(isActivatableTarget(document.createElement("div"))).toBe(false);
    expect(isActivatableTarget(document.createElement("a"))).toBe(false);
    expect(isActivatableTarget(window)).toBe(false);
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

  it("leaves Space and held keys alone on a focused button and a slider", () => {
    const store = setup();
    renderHook(() => useShortcuts(store));
    const button = document.createElement("button");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    document.body.append(button, slider);

    const onButton = press(button, { key: " " });
    expect(onButton.defaultPrevented).toBe(false);
    expect(store.getState().playback.isPlaying).toBe(false);

    const onSlider = press(slider, { key: "ArrowRight" });
    expect(onSlider.defaultPrevented).toBe(false);
    expect(store.getState().playback.index).toBe(0);

    press(button, { key: "ArrowRight" });
    expect(store.getState().playback.index).toBe(1);

    press(document.body, { key: " " });
    expect(store.getState().playback.isPlaying).toBe(true);
    const held = press(document.body, { key: " ", repeat: true });
    expect(held.defaultPrevented).toBe(true);
    expect(store.getState().playback.isPlaying).toBe(true);
  });

  it("does not drive playback from a key pressed on a resizable-split separator", () => {
    const store = setup();
    renderHook(() => useShortcuts(store));
    const separator = document.createElement("div");
    separator.setAttribute("role", "separator");
    document.body.append(separator);
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End", " "]) {
      press(separator, { key });
    }
    expect(store.getState().playback.index).toBe(0);
    expect(store.getState().playback.isPlaying).toBe(false);
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
