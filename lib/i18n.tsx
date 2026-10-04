"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "zh-TW" | "en";

const STORAGE_KEY = "cc_locale";

const dictionaries = {
  "zh-TW": {
    nav: {
      appName: "AI 課表助手",
      openMenu: "開啟選單",
      closeMenu: "關閉選單",
      menu: "選單",
      close: "關閉",
      home: "首頁",
      upload: "上傳課表",
      howItWorks: "使用方式",
      signIn: "使用 Google 帳號登入",
      signOut: "登出",
      language: "語言",
      langZh: "繁體中文",
      langEn: "English",
    },
    home: {
      badge: "專為學生打造的課表助手",
      title: "AI 課表助手",
      description:
        "拍下你的課表照片，我們幫你將混亂的截圖轉為清晰的週曆 — 讓你不再花時間手動抄課表。",
      footer: "拍攝課表、確認時段、下載行事曆。",
      steps: [
        {
          index: "01",
          title: "上傳",
          body: "從學校系統、選課平台或行事曆 app 上傳課表截圖。",
        },
        {
          index: "02",
          title: "辨識",
          body: "AI 讀取課程名稱、時間、教室與每週上課模式。",
        },
        {
          index: "03",
          title: "匯出",
          body: "在週曆上確認後，下載 .ics 檔匯入 Apple 或 Google 行事曆。",
        },
      ],
    },
    upload: {
      heading: "上傳課表截圖",
      hint: "拖放截圖到這裡，或點擊選擇檔案。支援 PNG、JPG、WEBP。",
      chooseFiles: "選擇檔案",
      invalidType: "請上傳截圖圖片（PNG、JPG、WEBP 或 GIF）。",
      parsing: "正在讀取課表…",
      parsingHint: "AI 正在辨識課名、時間與教室",
      parseFailed: "無法解析課表。",
      previewAlt: (name: string) => `預覽：${name}`,
      remove: "移除",
      empty: "這張截圖沒有找到課程。請換一張更清楚的圖片，或再解析一次。",
      parseAgain: "再解析一次",
      weeklyTitle: "週曆",
      weeklyHint: "拖曳或拉伸課程卡片調整時間（15 分鐘對齊），點擊可編輯課名與地點。",
      planPaid: (remaining: number) =>
        `NT$30 方案 · 剩餘 ${remaining} 次 gpt-4o 解析 · 無限下載 .ics`,
      planFree: "免費預覽 · 付 NT$30 解鎖 .ics 下載",
      download: "下載 .ics 行事曆",
      downloadLocked: "鎖定 · 下載 .ics 行事曆",
      icsError: "無法產生行事曆檔，請檢查時間後再試。",
    },
    paywall: {
      title: "解鎖行事曆匯出",
      offer: "NT$30：30 次高精度 gpt-4o 解析，並可無限下載 .ics",
      body: "請先使用 Google 帳號登入，再付款解鎖 gpt-4o 解析與 .ics 匯出。",
      pay: "以 Stripe 支付 NT$30",
      paying: "正在前往 Stripe…",
      keepFree: "繼續免費預覽",
      checkoutError: "無法開啟 Stripe 付款頁面。",
    },
    calendar: {
      edit: "編輯課程",
      course: "課程",
      professor: "授課教師",
      location: "地點",
      weekday: "星期",
      resizeHint: "拖曳或拉伸卡片可調整時間（15 分鐘對齊）",
      delete: "刪除",
      done: "完成",
      weekdays: {
        Monday: "週一",
        Tuesday: "週二",
        Wednesday: "週三",
        Thursday: "週四",
        Friday: "週五",
        Saturday: "週六",
        Sunday: "週日",
      } as Record<string, string>,
    },
  },
  en: {
    nav: {
      appName: "Course & Calendar Copilot",
      openMenu: "Open menu",
      closeMenu: "Close menu",
      menu: "Menu",
      close: "Close",
      home: "Home",
      upload: "Upload schedule",
      howItWorks: "How it works",
      signIn: "Sign in with Google",
      signOut: "Sign Out",
      language: "Language",
      langZh: "繁體中文",
      langEn: "English",
    },
    home: {
      badge: "Built for students",
      title: "Course & Calendar Copilot",
      description:
        "Snap a photo of your course schedule. We help turn messy screenshots into a clear week view — so you spend less time copying timeslots and more time actually going to class.",
      footer: "Upload a screenshot, verify courses, download .ics.",
      steps: [
        {
          index: "01",
          title: "Upload",
          body: "Drop a screenshot from your school portal, SIS, or calendar app.",
        },
        {
          index: "02",
          title: "Parse",
          body: "The copilot reads course names, times, rooms, and weekly patterns.",
        },
        {
          index: "03",
          title: "Export",
          body: "Review the week view, then download an .ics file for Apple or Google Calendar.",
        },
      ],
    },
    upload: {
      heading: "Drop your course schedule screenshot",
      hint: "Drop a screenshot here, or click to choose a file. PNG, JPG, and WEBP are supported.",
      chooseFiles: "Choose files",
      invalidType: "Please drop a screenshot image (PNG, JPG, WEBP, or GIF).",
      parsing: "Reading your schedule…",
      parsingHint: "AI is reading course names, times, and rooms",
      parseFailed: "Failed to parse the schedule.",
      previewAlt: (name: string) => `Preview of ${name}`,
      remove: "Remove",
      empty: "No courses found in this screenshot. Try a clearer image, or parse again.",
      parseAgain: "Parse again",
      weeklyTitle: "Weekly schedule",
      weeklyHint: "Drag or resize cards to adjust times (15-minute snap). Click a card to edit details.",
      planPaid: (remaining: number) =>
        `NT$30 plan · ${remaining} gpt-4o parses left · unlimited .ics`,
      planFree: "Free preview · unlock .ics with NT$30",
      download: "Download .ics Calendar",
      downloadLocked: "Locked · Download .ics Calendar",
      icsError: "Could not build the calendar file. Check the times and try again.",
    },
    paywall: {
      title: "Unlock calendar export",
      offer: "NT$30 for 30 high-precision gpt-4o extractions + unlimited .ics downloads",
      body: "Sign in with Google first. Then pay NT$30 to switch parsing to gpt-4o and unlock .ics export.",
      pay: "Pay NT$30 with Stripe",
      paying: "Redirecting to Stripe…",
      keepFree: "Keep free preview",
      checkoutError: "Could not start Stripe Checkout.",
    },
    calendar: {
      edit: "Edit class",
      course: "Course",
      professor: "Professor",
      location: "Location",
      weekday: "Weekday",
      resizeHint: "Drag or resize the card to change time (15-min snap)",
      delete: "Delete",
      done: "Done",
      weekdays: {
        Monday: "Monday",
        Tuesday: "Tuesday",
        Wednesday: "Wednesday",
        Thursday: "Thursday",
        Friday: "Friday",
        Saturday: "Saturday",
        Sunday: "Sunday",
      } as Record<string, string>,
    },
  },
} as const;

type Dictionary = (typeof dictionaries)[Locale];

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh-TW");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh-TW") setLocaleState(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale === "zh-TW" ? "zh-Hant" : "en";
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale: setLocaleState,
      t: dictionaries[locale],
    }),
    [locale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useI18n must be used within LanguageProvider");
  }
  return context;
}
