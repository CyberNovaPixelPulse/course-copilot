import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { Geist, Geist_Mono, Noto_Sans_TC } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import Providers from "./providers";
import TopNav from "./components/TopNav";

const DevFloatingToolbar = dynamic(() => import("./components/DevFloatingToolbar"));
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
  title: "AI 課表助手 - 截圖一鍵匯入行事曆",
  description:
    "專為學生打造的 AI 課表助手，上傳課表截圖即可自動轉換並匯入 Apple / Google 日曆。",
  keywords: [
    "AI 課表助手",
    "課表轉行事曆",
    "AI 課表",
    "課表 ics",
    "necterelux",
  ],
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
          {process.env.NODE_ENV === "development" ? <DevFloatingToolbar /> : null}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
