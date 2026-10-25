import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { MotionConfig } from "motion/react";
import { NonceProvider } from "@/features/playground/components/csp/useNonce";
import { PlaygroundShell } from "@/features/playground/components/PlaygroundShell";
import { EXAMPLES } from "@/features/playground/examples";
import { PlaygroundProvider } from "@/features/playground/store/PlaygroundProvider";
import { modeDefaults, PREFS_COOKIES, parsePrefs } from "@/features/preferences/prefs";

export const metadata: Metadata = { title: "Playground" };

// The program the page opens with: "nextTick vs Promise", whose output order is the product's first lesson.
const DEFAULT_EXAMPLE_ID = "nexttick-vs-promise";

// Server Component: composes the client providers around the IDE shell.
export default async function PlaygroundPage() {
  // proxy.ts mints the nonce per request; client code needs it only for injected <style> elements.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // The first paint already uses the learner's mode: its default playback speed comes from the same cookie as the theme.
  const jar = await cookies();
  const prefs = parsePrefs({ theme: jar.get(PREFS_COOKIES.theme)?.value, mode: jar.get(PREFS_COOKIES.mode)?.value });
  const example = EXAMPLES.find((e) => e.id === DEFAULT_EXAMPLE_ID) ?? EXAMPLES[0];
  return (
    <NonceProvider nonce={nonce}>
      <PlaygroundProvider
        initialSpeed={modeDefaults(prefs.mode).speed}
        {...(example ? { initialSource: example.source, initialLang: example.lang } : {})}
      >
        <MotionConfig reducedMotion="user">
          <PlaygroundShell />
        </MotionConfig>
      </PlaygroundProvider>
    </NonceProvider>
  );
}
