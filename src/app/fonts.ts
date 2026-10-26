import { Anton, Dela_Gothic_One, Inter } from "next/font/google";

export const display = Anton({ weight: "400", subsets: ["latin"], variable: "--font-display" });
// Dela Gothic One ships Japanese glyphs; let the browser fetch only what's used.
export const jp = Dela_Gothic_One({ weight: "400", subsets: ["latin"], variable: "--font-jp", preload: false });
export const body = Inter({ subsets: ["latin"], variable: "--font-body" });
