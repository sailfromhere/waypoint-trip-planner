import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Editorial serif for the wordmark, page/trip titles, and card/popup titles —
// the "field guide" voice. Geist still carries all data/UI for legibility.
// `opsz` is Fraunces's optical-size axis; we use it at display sizes.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  // Variable font (full weight range) + the optical-size axis. NOTE: next/font
  // forbids a fixed `weight` array alongside `axes` — omit weight to load it as
  // a variable font.
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Waypoint",
  description: "Turn a vague travel idea into a practical itinerary",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        {/* Chinese companions to the Latin faces (per-character font fallback):
            Noto Sans SC pairs with Geist (UI/data); LXGW WenKai (霞鹜文楷), a warm
            literary Kai face, pairs with Fraunces (titles). Latin glyphs always
            resolve to Geist/Fraunces first; only CJK falls through to these.
            Noto SC: Google, unicode-range glyph-sliced (light). WenKai:
            SELF-HOSTED Regular weight, also unicode-range chunked (97 woff2 in
            /public/fonts/wenkai) so the browser only fetches chunks for the
            characters actually used — no CDN dependency. display=swap → Latin
            never waits on CJK. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link href="/fonts/wenkai/lxgwwenkai-regular.css" rel="stylesheet" />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
