import type { Metadata, Viewport } from "next";
import { body, display, jp } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dribble Dojo · ドリブル道場",
  description: "Anime-style basketball dribbling simulator.",
};

export const viewport: Viewport = {
  themeColor: "#2a1b10",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${jp.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
