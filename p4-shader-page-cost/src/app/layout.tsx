import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "p4-shader-page-cost",
  description: "What an animated shader background costs on a real landing page, measured in the browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
