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
  metadataBase: new URL("https://ics.necterelux.com"),
  title: "課表轉行事曆｜AI 截圖辨識、匯入 iPhone 與 Google 日曆 | Course Copilot",
  alternates: { canonical: "/" },
  description:
    "Course Copilot AI 課表助手：上傳大學課表截圖，辨識課程、時間與教室，確認每週課表後匯出 ICS 檔，匯入 iPhone／Apple 行事曆與 Google 日曆。提供免費辨識預覽，行事曆匯出需解鎖。",
  keywords: ["AI課表", "課表轉行事曆", "課表ics", "大學課表", "Apple行事曆課表", "Course Copilot"],
  openGraph: {
    title: "課表轉行事曆｜AI 課表助手 Course Copilot",
    description: "上傳課表截圖，確認課程與時段後匯出 ICS，匯入 iPhone 與 Google 日曆。",
    url: "https://ics.necterelux.com",
    siteName: "AI 課表助手",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "AI 課表助手預覽圖",
      },
    ],
    locale: "zh_TW",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "課表轉行事曆｜AI 課表助手 Course Copilot",
    description: "上傳課表截圖，確認課程與時段後匯出 ICS，匯入 iPhone 與 Google 日曆。",
    images: ["/og-image.png"],
  },
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
