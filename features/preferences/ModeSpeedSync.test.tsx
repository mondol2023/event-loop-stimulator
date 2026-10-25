// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaygroundProvider } from "@/features/playground/store/PlaygroundProvider";
import { usePlaygroundStore } from "@/features/playground/store/PlaygroundContext";
import type { PlaygroundStore } from "@/features/playground/store/playgroundStore";
import { ModeSpeedSync } from "./ModeSpeedSync";
import { PreferencesProvider } from "./PreferencesProvider";
import { usePreferences } from "./usePreferences";
import type { PreferencesValue } from "./PreferencesProvider";

class FakeWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  postMessage(): void {}
  terminate(): void {}
}

function setup() {
  const captured: { store?: PlaygroundStore; prefs?: PreferencesValue } = {};
  function Probe() {
    captured.store = usePlaygroundStore();
    captured.prefs = usePreferences();
    return null;
  }
  render(
    <PreferencesProvider initial={{ theme: "dark", mode: "self-study", themeExplicit: false }}>
      <PlaygroundProvider>
        <ModeSpeedSync />
        <Probe />
      </PlaygroundProvider>
    </PreferencesProvider>,
  );
  return captured as Required<typeof captured>;
}

describe("ModeSpeedSync", () => {
  beforeEach(() => vi.stubGlobal("Worker", FakeWorker));
  afterEach(() => vi.unstubAllGlobals());

  it("leaves a persisted speed untouched on first mount", () => {
    const c = setup();
    act(() => c.store.getState().setSpeed(2));
    expect(c.store.getState().playback.speed).toBe(2);
  });

  it("resets speed to the mode default when the mode changes", () => {
    const c = setup();
    expect(c.store.getState().playback.speed).toBe(1);
    act(() => c.prefs.setMode("classroom"));
    expect(c.store.getState().playback.speed).toBe(0.5);
  });
});
