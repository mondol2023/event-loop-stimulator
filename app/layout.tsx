import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { PREFS_COOKIES, parsePrefs } from "@/features/preferences/prefs";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import "./globals.css";

// UI text only. IBM Plex Sans is not a variable font, so weights are explicit.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Code, assembly, hex, register values and addresses only.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Silicon Loop", template: "%s · Silicon Loop" },
  description:
    "See how V8 really runs JavaScript: bytecode, machine code, hidden classes and the Node event loop, tick by tick and exact to real Node.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The CSP nonce is minted per request in proxy.ts and Next applies it while rendering,
  // so every page must render per request instead of being prerendered at build time.
  await connection();
  // Classes are rendered here from the cookies so the first paint already has the right theme.
  const jar = await cookies();
  const prefs = parsePrefs({ theme: jar.get(PREFS_COOKIES.theme)?.value, mode: jar.get(PREFS_COOKIES.mode)?.value });
  const classes = [
    prefs.theme === "dark" ? "dark" : "",
    prefs.mode === "classroom" ? "mode-classroom" : "",
    plexSans.variable,
    jetbrainsMono.variable,
    "h-full antialiased",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    // Dark-first IDE theme; the light theme (classroom projectors) is the
    // :root base in globals.css and is selected by omitting `dark`.
    <html lang="en" className={classes}>
      <body className="flex min-h-full flex-col">
        <PreferencesProvider initial={prefs}>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
