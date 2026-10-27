// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomPanel, type BottomTab } from "./BottomPanel";

// The lazy views need a bundler; here each is a marker, so the test pins which tab mounts which view.
vi.mock("../lazy", () => ({
  EventLoopViewLazy: () => <p>event-loop-view</p>,
  V8InternalsViewLazy: () => <p>v8-internals-view</p>,
  HardwareViewLazy: () => <p>hardware-view</p>,
}));

afterEach(cleanup);

function panel(tab: BottomTab) {
  return render(<BottomPanel tab={tab} onTabChange={() => undefined} collapsed={false} onCollapsedChange={() => undefined} />);
}

describe("BottomPanel", () => {
  it("mounts the V8 Internals view on the v8 tab, not the Phase 7 placeholder", () => {
    panel("v8");
    expect(screen.getByText("v8-internals-view")).toBeTruthy();
    expect(screen.queryByText(/Phase 7/)).toBeNull();
  });

  it("mounts the Hardware view on the hardware tab, not the Phase 7 placeholder", () => {
    panel("hardware");
    expect(screen.getByText("hardware-view")).toBeTruthy();
    expect(screen.queryByText(/Phase 7/)).toBeNull();
    expect(screen.queryByText("v8-internals-view")).toBeNull();
  });

  it("keeps the Hardware tab visible at every width (D5 gives phones the 2D board)", () => {
    panel("event-loop");
    const tab = screen.getByRole("tab", { name: "Hardware" });
    expect(tab.className).not.toMatch(/(^|\s)(md:|lg:|sm:)?hidden(\s|$)/);
  });
});
