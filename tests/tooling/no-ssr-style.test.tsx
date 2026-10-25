import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NonceProvider } from "@/features/playground/components/csp/useNonce";
import { PipelineSmoke } from "@/features/playground/components/PipelineSmoke";
import { PlaygroundProvider } from "@/features/playground/store/PlaygroundProvider";

// CSP is style-src 'self' 'nonce-...' (ADR-012): any SSR style attribute is blocked in the browser.
// Task 8 retargets this to PlaygroundShell's server output.
const SSR_STYLE_ATTRIBUTE = /\sstyle="/;
const UNNONCED_STYLE_ELEMENT = /<style(?![^>]*\snonce=)/;

function shippedTree(probe?: React.ReactNode) {
  return (
    <NonceProvider nonce="test-nonce">
      <PlaygroundProvider>
        <PipelineSmoke />
        {probe}
      </PlaygroundProvider>
    </NonceProvider>
  );
}

describe("no SSR style (CSP style-src nonce)", () => {
  it("the playground server tree emits no style attribute", () => {
    expect(renderToString(shippedTree())).not.toMatch(SSR_STYLE_ATTRIBUTE);
  });

  it("the playground server tree emits no style element without a nonce", () => {
    expect(renderToString(shippedTree())).not.toMatch(UNNONCED_STYLE_ELEMENT);
  });

  it("the guard catches a style attribute", () => {
    // style={{}} renders no attribute in React, so the probe needs a real declaration.
    const html = renderToString(shippedTree(<div style={{ color: "red" }} />));
    expect(html).toMatch(SSR_STYLE_ATTRIBUTE);
  });
});
