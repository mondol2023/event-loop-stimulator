// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSource } from "../../test/fixtureTimeline";
import { ProblemsList } from "./ProblemsList";

afterEach(cleanup);

function diagnosticsFor(source: string) {
  const compiled = runSource(source, 1).find((r) => r.type === "compiled");
  if (compiled?.type !== "compiled") throw new Error("no compiled response");
  return compiled.diagnostics;
}

describe("ProblemsList", () => {
  const source = "const a = 1;\nMath.random();";
  const diagnostics = diagnosticsFor(source);

  it("shows the code, position, message, hint and a link to the subset reference", () => {
    const [d] = diagnostics;
    if (!d) throw new Error("Math.random() must be refused");
    render(<ProblemsList diagnostics={diagnostics} source={source} />);
    expect(screen.getByText(/E_EXCLUDED_API/)).toBeTruthy();
    expect(screen.getByText(/^L2:\d+ E_EXCLUDED_API/)).toBeTruthy();
    expect(screen.getByText(d.message, { exact: false })).toBeTruthy();
    expect(screen.getByText(d.hint)).toBeTruthy();
    expect(screen.getByRole("link", { name: /why/i }).getAttribute("href")).toBe("/docs/subset#E_EXCLUDED_API");
  });

  it("selects the diagnostic when its row is clicked", () => {
    const onSelect = vi.fn();
    render(<ProblemsList diagnostics={diagnostics} source={source} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /E_EXCLUDED_API/ }));
    expect(onSelect).toHaveBeenCalledWith(diagnostics[0]);
  });

  it("renders nothing without diagnostics", () => {
    const { container } = render(<ProblemsList diagnostics={[]} source="" />);
    expect(container.firstChild).toBeNull();
  });
});
