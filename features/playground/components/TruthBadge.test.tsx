// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TRUTH_TOOLTIPS, type TruthLevel } from "@/core/shared/fidelity";
import { TruthBadge } from "./TruthBadge";

const LABELS: Record<TruthLevel, string> = {
  exact: "Exact",
  "verified-model": "Verified model",
  modeled: "Modeled",
  illustrative: "Illustrative",
};

describe("TruthBadge", () => {
  afterEach(cleanup);

  for (const level of Object.keys(LABELS) as TruthLevel[]) {
    it(`renders ${level} with its label and exact tooltip sentence`, () => {
      render(<TruthBadge level={level} />);
      const button = screen.getByRole("button");
      expect(button.textContent).toBe(LABELS[level]);
      expect(button.getAttribute("aria-label")).toBe(`${LABELS[level]}: ${TRUTH_TOOLTIPS[level]}`);
    });
  }

  it("renders exact-encoding with the FIDELITY.md sentence", () => {
    render(<TruthBadge level="exact-encoding" />);
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("Exact encoding");
    expect(button.getAttribute("aria-label")).toBe(
      "Exact encoding: Exact encoding of the shown assembly: the bytes are what a real assembler produces for these instructions.",
    );
  });
});
