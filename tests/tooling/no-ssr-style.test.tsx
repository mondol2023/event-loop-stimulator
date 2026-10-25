import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NonceMotionConfig } from "@/features/playground/components/csp/NonceMotionConfig";
import { NonceProvider } from "@/features/playground/components/csp/useNonce";
import { PlaygroundShell } from "@/features/playground/components/PlaygroundShell";
import { EXAMPLES } from "@/features/playground/examples";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { PlaygroundProvider } from "@/features/playground/store/PlaygroundProvider";

// CSP is style-src 'self' 'nonce-...' (ADR-012): any SSR style attribute is blocked in the browser.
// The tree below mirrors app/playground/page.tsx (an async page cannot be rendered by renderToString).
const SSR_STYLE_ATTRIBUTE = /\sstyle="/;
const UNNONCED_STYLE_ELEMENT = /<style(?![^>]*\snonce=)/;

const EXAMPLE = EXAMPLES.find((e) => e.id === "nexttick-vs-promise");

function shippedTree(probe?: React.ReactNode) {
  return (
    <PreferencesProvider initial={{ theme: "dark", mode: "self-study", themeExplicit: false }}>
      <NonceProvider nonce="test-nonce">
        <PlaygroundProvider {...(EXAMPLE ? { initialSource: EXAMPLE.source, initialLang: EXAMPLE.lang } : {})}>
          <NonceMotionConfig>
            <PlaygroundShell />
          </NonceMotionConfig>
          {probe}
        </PlaygroundProvider>
      </NonceProvider>
    </PreferencesProvider>
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

  it("the page wraps the shell in the nonce-carrying Motion config, never a bare MotionConfig", () => {
    // MotionConfig without a nonce makes popLayout inject an un-nonced <style> that the production CSP blocks.
    const page = readFileSync(join(process.cwd(), "app", "playground", "page.tsx"), "utf8");
    expect(page).toContain("<NonceMotionConfig>");
    expect(page).not.toMatch(/<MotionConfig[\s>]/);
  });
});
