import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_CODES } from "@/core/shared/diagnostics";
import SubsetPage from "./page";

describe("/docs/subset", () => {
  const html = renderToString(<SubsetPage />);

  it("has an anchor for every diagnostic code", () => {
    for (const code of DIAGNOSTIC_CODES) expect(html).toContain(`id="${code}"`);
  });

  it("emits no style attribute and shows the limits from core", () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).toContain("10,240 bytes");
    expect(html).toContain("5,000");
  });
});
