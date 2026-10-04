import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_TC } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import Providers from "./providers";
import TopNav from "./components/TopNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansTc = Noto_Sans_TC({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "AI 課表助手",
  description:
    "拍下你的課表照片，我們幫你將混亂的截圖轉為清晰的週曆 — 讓你不再花時間手動抄課表。",
  verification: {
    google: "11dA7xDPvOjAqIt9fiVCW5Fg6ikuqB5Dc5U4uc9eNuw",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansTc.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>
          <TopNav />
          <div className="flex min-h-full flex-1 flex-col pt-16">{children}</div>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
