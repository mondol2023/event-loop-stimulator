import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark-first IDE theme; the light theme (classroom projectors) is the
    // :root base in globals.css and is selected by removing `dark`.
    <html lang="en" className={`dark ${plexSans.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
