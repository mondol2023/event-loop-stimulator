// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { Profiler, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TaskRef } from "@/core/timeline/Tick";
import { NonceMotionConfig } from "@/features/playground/components/csp/NonceMotionConfig";
import { NonceProvider } from "@/features/playground/components/csp/useNonce";
import { PlaygroundStoreContext } from "@/features/playground/store/PlaygroundContext";
import { createPlaygroundStore, type PlaygroundStore } from "@/features/playground/store/playgroundStore";
import { getTimeline } from "@/features/playground/store/timelineHolder";
import { fixtureRun, runSource } from "@/features/playground/test/fixtureTimeline";
import { CallStackRegion } from "./CallStackRegion";
import { ConsolePanel } from "./ConsolePanel";
import { EventLoopView } from "./EventLoopView";
import { QueueRegion } from "./QueueRegion";

// Exits and layout moves would otherwise keep removed chips in the DOM for a few frames.
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function readyStore(name: string): PlaygroundStore {
  const { compiled, simulated } = fixtureRun(name);
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: compiled });
  store.getState().applyPipelineEvent({ kind: "response", response: simulated });
  return store;
}

const inStore = (store: PlaygroundStore, ui: ReactElement): ReactElement => <PlaygroundStoreContext.Provider value={store}>{ui}</PlaygroundStoreContext.Provider>;
const seek = (store: PlaygroundStore, index: number) => act(() => store.getState().seek(index));

const chipLabels = (region: HTMLElement): string[] => within(region).queryAllByTestId("task-label").map((n) => n.textContent ?? "");
const region = (id: string): HTMLElement => screen.getByTestId(id);

describe("EventLoopView: the probed queues", () => {
  it("lists two nextTick chips and two microtask chips at tick 7 of nexttick-vs-promise", () => {
    const store = readyStore("nexttick-vs-promise");
    seek(store, 7);
    render(inStore(store, <EventLoopView />));

    expect(chipLabels(region("region-nexttick"))).toEqual(["process.nextTick((anonymous))", "process.nextTick((anonymous))"]);
    expect(chipLabels(region("region-microtask"))).toEqual(["then((anonymous))", "then((anonymous))"]);
  });

  it("labels the two ownership groups in text and names every region", () => {
    const store = readyStore("nexttick-vs-promise");
    render(inStore(store, <EventLoopView />));

    const v8 = screen.getByRole("group", { name: "V8" });
    const node = screen.getByRole("group", { name: "Node / libuv" });
    expect(within(v8).getByText("owned by V8")).toBeTruthy();
    expect(within(node).getByText("owned by Node/libuv")).toBeTruthy();
    expect(within(v8).getByTestId("region-call-stack")).toBeTruthy();
    expect(within(v8).getByTestId("region-microtask")).toBeTruthy();
    for (const id of ["region-nexttick", "region-timers", "region-check", "region-host"]) {
      expect(within(node).getByTestId(id)).toBeTruthy();
    }
    for (const id of ["region-call-stack", "region-microtask", "region-nexttick", "region-timers", "region-check", "region-host"]) {
      const el = region(id);
      expect(el.getAttribute("aria-label"), id).toBeTruthy();
      expect(within(el).getByRole("heading")).toBeTruthy();
    }
  });

  it("shows the teaching empty state for a queue with nothing in it", () => {
    const store = readyStore("nexttick-vs-promise");
    seek(store, 7);
    render(inStore(store, <EventLoopView />));
    expect(within(region("region-timers")).getByText("empty: the loop moves on")).toBeTruthy();
  });

  it("draws the call stack with the newest frame on top", () => {
    const source = "function inner() { console.log(1); }\nfunction outer() { inner(); }\nouter();\n";
    const responses = runSource(source, 1);
    const store = createPlaygroundStore();
    for (const response of responses) store.getState().applyPipelineEvent({ kind: "response", response });
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    let deepest = 0;
    for (let i = 0; i < timeline.length; i++) if (timeline.at(i).callStack.length > timeline.at(deepest).callStack.length) deepest = i;
    const stack = timeline.at(deepest).callStack;
    expect(stack.length, "a tick with three frames: the script, outer and inner").toBeGreaterThanOrEqual(3);

    seek(store, deepest);
    render(inStore(store, <EventLoopView />));
    const names = within(region("region-call-stack")).getAllByTestId("frame-name").map((n) => n.textContent);
    expect(names).toEqual(stack.map((f) => f.functionName).reverse());
    expect(names[0]).toBe("inner");
  });
});

describe("QueueRegion", () => {
  it("renders 12 chips and a chip reading +188 more for 200 tasks (Review Focus 4)", () => {
    const tasks: TaskRef[] = Array.from({ length: 200 }, (_, i) => ({
      id: i as TaskRef["id"],
      kind: "timeout",
      label: `setTimeout(f${i}, 0)`,
      origin: "setTimeout",
    }));
    render(<QueueRegion testId="region-timers" title="Timers" owner="Node/libuv" tasks={tasks} tone="macrotask" />);

    expect(screen.getAllByTestId("task-chip")).toHaveLength(12);
    expect(screen.getByText("+188 more")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Timers/ }).textContent).toContain("200");
  });

  it("shows no overflow chip at or under 12 tasks", () => {
    const tasks: TaskRef[] = Array.from({ length: 12 }, (_, i) => ({ id: i as TaskRef["id"], kind: "immediate", label: `setImmediate(f${i})`, origin: "setImmediate" }));
    render(<QueueRegion testId="region-check" title="Check" owner="Node/libuv" tasks={tasks} tone="macrotask" />);
    expect(screen.getAllByTestId("task-chip")).toHaveLength(12);
    expect(screen.queryByText(/more$/)).toBeNull();
  });
});

describe("ConsolePanel", () => {
  it("renders zero extra times across seeks between ticks that share a console array", () => {
    const store = readyStore("nexttick-vs-promise");
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    let a = -1;
    for (let i = 0; i + 1 < timeline.length; i++) {
      if (timeline.at(i).console === timeline.at(i + 1).console) {
        a = i;
        break;
      }
    }
    expect(a, "two adjacent ticks share a console reference").toBeGreaterThanOrEqual(0);
    seek(store, a);

    let renders = 0;
    render(
      inStore(
        store,
        <Profiler id="console" onRender={() => renders++}>
          <ConsolePanel />
        </Profiler>,
      ),
    );
    const before = renders;
    seek(store, a + 1);
    seek(store, a);
    seek(store, a + 1);
    expect(renders - before).toBe(0);
  });

  it("does not re-render when the surrounding view re-renders for a queue change", () => {
    const store = readyStore("nexttick-vs-promise");
    // Tick 2 to 3 changes the nextTick queue but not the console.
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    expect(timeline.at(2).console).toBe(timeline.at(3).console);
    seek(store, 2);
    let renders = 0;
    render(
      inStore(
        store,
        <>
          <EventLoopView />
          <Profiler id="console" onRender={() => renders++}>
            <ConsolePanel />
          </Profiler>
        </>,
      ),
    );
    const before = renders;
    seek(store, 3);
    expect(renders - before).toBe(0);
  });

  it("holds the recorded stdout at the last tick", () => {
    const recorded = JSON.parse(readFileSync(join(process.cwd(), "tests", "conformance", "fixtures", "nexttick-vs-promise.expected.json"), "utf8")) as {
      outcomes: { stdout: string }[];
    };
    const store = readyStore("nexttick-vs-promise");
    seek(store, store.getState().playback.length - 1);
    render(inStore(store, <ConsolePanel />));
    expect(screen.getByTestId("console").textContent).toBe(recorded.outcomes[0]?.stdout);
  });

  it("starts empty at tick 0 and labels it", () => {
    const store = readyStore("nexttick-vs-promise");
    seek(store, 0);
    render(inStore(store, <ConsolePanel />));
    expect(screen.getByTestId("console").textContent).toBe("");
    expect(screen.getByText("Exact")).toBeTruthy();
  });

  it("names the console output as a group, so an empty log still has an accessible name", () => {
    const store = readyStore("nexttick-vs-promise");
    seek(store, 0);
    render(inStore(store, <ConsolePanel />));
    expect(screen.getByRole("group", { name: "Console output" })).toBe(screen.getByTestId("console"));
  });

  it("marks stderr lines with a label and the error style, as text only", () => {
    const store = readyStore("console-error-warn");
    seek(store, store.getState().playback.length - 1);
    render(inStore(store, <ConsolePanel />));
    const stderr = screen.getByTestId("console").querySelector('[data-stream="stderr"]');
    expect(stderr, "the program prints to stderr").not.toBeNull();
    expect(stderr?.className).toContain("text-destructive");
    expect(stderr?.children).toHaveLength(0);
  });
});

describe("PhaseRing", () => {
  it("marks the current libuv phase with aria-current=step", () => {
    const store = readyStore("timeout-vs-immediate-main");
    // Tick 5: the loop is in the check phase's transition.
    seek(store, 5);
    render(inStore(store, <EventLoopView />));
    const ring = screen.getByRole("list", { name: "Event loop phases" });
    const items = within(ring).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["timers", "pending", "poll", "check", "close"]);
    const current = items.filter((i) => i.getAttribute("aria-current") === "step");
    expect(current.map((i) => i.textContent)).toEqual(["check"]);
  });

  it("says what runs between phases", () => {
    const store = readyStore("nexttick-vs-promise");
    seek(store, 1);
    const { rerender } = render(inStore(store, <EventLoopView />));
    expect(screen.getByText("running the main script")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Event loop phases" })).queryByRole("listitem", { current: "step" })).toBeNull();

    seek(store, 7);
    rerender(inStore(store, <EventLoopView />));
    expect(screen.getByText("draining nextTicks/microtasks")).toBeTruthy();
  });
});

describe("nondeterminism warnings on chips", () => {
  it("flags the affected timer and immediate chips on timeout-vs-immediate-main", () => {
    const store = readyStore("timeout-vs-immediate-main");
    seek(store, 3);
    render(inStore(store, <EventLoopView />));
    for (const id of ["region-timers", "region-check"]) {
      const chips = within(region(id)).getAllByTestId("task-chip");
      expect(chips).toHaveLength(1);
      expect(within(chips[0] as HTMLElement).getByText("Order not guaranteed")).toBeTruthy();
    }
  });

  it("shows no warning chip while no warning is current", () => {
    const store = readyStore("timeout-vs-immediate-main");
    seek(store, 2);
    render(inStore(store, <EventLoopView />));
    expect(screen.queryByText("Order not guaranteed")).toBeNull();
  });

  it("stops flagging once the race is over: the immediate has run, so the lone timer is unflagged", () => {
    const store = readyStore("timeout-vs-immediate-main");
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    // Tick 6: the warning is still carried, the immediate is gone, and one timer remains pending.
    expect(timeline.at(6).warnings.length).toBeGreaterThan(0);
    expect(timeline.at(6).immediateQueue).toHaveLength(0);
    expect(timeline.at(6).timerQueue).toHaveLength(1);
    seek(store, 6);
    render(inStore(store, <EventLoopView />));
    expect(screen.queryByText("Order not guaranteed")).toBeNull();
  });

  it("does not flag nextTick or microtask chips", () => {
    const store = readyStore("timeout-vs-immediate-main");
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    const at = Array.from({ length: timeline.length }, (_, i) => i).find((i) => timeline.at(i).warnings.length > 0 && timeline.at(i).nextTickQueue.length > 0);
    expect(at, "a tick with a warning and a nextTick task").toBeDefined();
    seek(store, at ?? 0);
    render(inStore(store, <EventLoopView />));
    expect(within(region("region-nexttick")).queryByText("Order not guaranteed")).toBeNull();
  });
});

describe("host APIs", () => {
  it("lists each pending timer with its kind and due time as text", () => {
    const store = readyStore("timeout-vs-immediate-main");
    seek(store, 2);
    render(inStore(store, <EventLoopView />));
    const host = region("region-host");
    expect(within(host).getByText("timeout · due 1 ms")).toBeTruthy();
    expect(within(host).getByText("immediate")).toBeTruthy();
  });
});

describe("tooltips on touch", () => {
  it("opens a chip's origin on a tap and closes it on the next", () => {
    // Radix measures the tooltip's arrow with ResizeObserver, which jsdom lacks.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    const tasks: TaskRef[] = [{ id: 1 as TaskRef["id"], kind: "timeout", label: "setTimeout(f, 0)", origin: "setTimeout" }];
    render(<QueueRegion testId="region-timers" title="Timers" owner="Node/libuv" tasks={tasks} tone="macrotask" />);
    const chip = screen.getByTestId("task-chip");

    // A touch is pointerdown, pointerup, then click; Radix's trigger closes the tooltip on that click.
    fireEvent.pointerDown(chip, { pointerType: "touch" });
    fireEvent.click(chip);
    expect(screen.getByRole("tooltip").textContent).toContain("queued by setTimeout");

    fireEvent.pointerDown(chip, { pointerType: "touch" });
    fireEvent.click(chip);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("CSP nonce on Motion's injected style (D1)", () => {
  /** jsdom measures every box as 0 by 0, so PopChild would return early; give the exiting frame a size. */
  function giveBoxesASize(): void {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
      const style = real(el, pseudo);
      return new Proxy(style, {
        get(target, key) {
          if (key === "height") return "20px";
          if (key === "width") return "100px";
          const value: unknown = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
  }

  /** The style elements a frame's exit adds to document.head. */
  function stylesAddedByAnExit(nonce: string | undefined): HTMLStyleElement[] {
    const source = "function inner() { console.log(1); }\nfunction outer() { inner(); }\nouter();\n";
    const store = createPlaygroundStore();
    for (const response of runSource(source, 1)) store.getState().applyPipelineEvent({ kind: "response", response });
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    let deepest = 0;
    for (let i = 0; i < timeline.length; i++) if (timeline.at(i).callStack.length > timeline.at(deepest).callStack.length) deepest = i;
    seek(store, deepest);
    render(
      inStore(
        store,
        <NonceProvider nonce={nonce}>
          <NonceMotionConfig>
            <CallStackRegion />
          </NonceMotionConfig>
        </NonceProvider>,
      ),
    );
    giveBoxesASize();
    const before = new Set(document.head.querySelectorAll("style"));
    const shallower = Array.from({ length: timeline.length }, (_, i) => i).find((i) => i > deepest && timeline.at(i).callStack.length < timeline.at(deepest).callStack.length);
    if (shallower === undefined) throw new Error("no tick after the deepest one pops a frame");
    seek(store, shallower);
    return Array.from(document.head.querySelectorAll("style")).filter((el) => !before.has(el));
  }

  it("gives the style that popLayout injects for an exiting frame the page's nonce", () => {
    MotionGlobalConfig.skipAnimations = false;
    try {
      const added = stylesAddedByAnExit("test-nonce");
      expect(added.length, "the exit injected a style element").toBeGreaterThan(0);
      expect(added.every((el) => el.nonce === "test-nonce")).toBe(true);
    } finally {
      MotionGlobalConfig.skipAnimations = true;
    }
  });

  it("injects it without a nonce when the config carries none (the check can fail)", () => {
    MotionGlobalConfig.skipAnimations = false;
    try {
      const added = stylesAddedByAnExit(undefined);
      expect(added.length).toBeGreaterThan(0);
      expect(added.some((el) => !el.nonce)).toBe(true);
    } finally {
      MotionGlobalConfig.skipAnimations = true;
    }
  });
});

describe("server rendering (D1)", () => {
  it("renders chips without Motion, so the server HTML has no style attribute", () => {
    const tasks: TaskRef[] = [{ id: 1 as TaskRef["id"], kind: "nextTick", label: "process.nextTick((anonymous))", origin: "process.nextTick" }];
    // The store's server snapshot is its initial (empty) state, so a queue is rendered from props here.
    const html = renderToString(<QueueRegion testId="region-nexttick" title="nextTick queue" owner="Node/libuv" tasks={tasks} tone="nextTick" />);
    expect(html).toContain("process.nextTick((anonymous))");
    expect(html).not.toMatch(/\sstyle="/);
  });
});
