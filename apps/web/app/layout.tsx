import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import "./globals.css";

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "rb/mail — one calm inbox",
  description: "A unified, intent-first inbox for every account.",
  applicationName: "rb/mail",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f2efe8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
