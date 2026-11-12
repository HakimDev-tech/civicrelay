import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CivicRelay — Clear information. Safer action.",
    template: "%s | CivicRelay",
  },
  description:
    "CivicRelay helps authorized teams turn official emergency alerts into accessible, multilingual public guidance.",
  applicationName: "CivicRelay",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f8f6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
