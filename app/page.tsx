"use client";

import { version } from "../package.json";
import ScheduleUpload from "./components/ScheduleUpload";
import { useI18n } from "@/lib/i18n";
import { supportEmail } from "@/lib/site-contact";

const BUILD_DATE = "2026.10.08";

export default function Home() {
  const { t, locale } = useI18n();
  const emailLine =
    t.home.supportEmailLine?.(supportEmail) ?? `Support email: ${supportEmail}`;
  const pricingTerms =
    t.home.pricingTerms ??
    "Pricing: This service provides AI schedule recognition and calendar export. The free plan includes basic recognition and preview. Unlocking high-precision recognition and calendar (.ics) export is a one-time purchase of NT$9 (30 high-precision credits). Digital goods are delivered as soon as they are unlocked.";

  return (
    <div className="flex min-h-full flex-col">
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 pb-12 pt-8 sm:pt-16">
          <p className="mb-4 inline-flex rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
            {t.home.badge}
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-6xl sm:leading-[1.1]">
            {t.home.title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-600">
            {t.home.description}
          </p>
        </section>

        <ScheduleUpload />

        <section
          id="how-it-works"
          className="mx-auto mt-16 grid w-full max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-3"
        >
          {t.home.steps.map((step) => (
            <article
              key={step.index}
              className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm"
            >
              <p className="text-sm font-medium text-indigo-600">{step.index}</p>
              <h2 className="mt-2 text-xl font-semibold text-stone-900">{step.title}</h2>
              <p className="mt-3 text-sm leading-6 text-stone-600">{step.body}</p>
            </article>
          ))}
        </section>
        {locale === "zh-TW" && (
          <section aria-labelledby="calendar-faq" className="mx-auto w-full max-w-6xl px-6 pb-20">
            <h2 id="calendar-faq" className="text-2xl font-semibold text-stone-900">
              課表轉行事曆：匯入教學與常見問題
            </h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              {[
                ["如何把課表截圖轉成 ICS 檔？", "上傳學校選課系統的課表截圖，讓 AI 辨識課程、時間與教室。在週曆預覽中檢查並修正辨識結果，確認學期日期後，解鎖行事曆匯出並下載 .ics 檔案。"],
                ["如何將課表匯入 Google 日曆？", "在電腦開啟 Google 日曆，進入「設定」→「匯入及匯出」，選取下載的 .ics 檔及目標日曆，再按「匯入」。建議先建立專用的課表日曆，方便日後管理整個學期的課程。"],
                ["如何將課表加入 iPhone／Apple 行事曆？", "用 Apple 行事曆開啟匯出的 .ics 檔並確認加入課程。若 iPhone 的檔案預覽無法加入，可先在 Mac 的行事曆匯入，並透過相同的 iCloud 帳號同步到 iPhone。"],
                ["匯入後會自動同步課表修改嗎？", "ICS 匯入會建立當次匯出的課程事件；之後在本網站修改課表，不會自動更新已匯入的事件。重新匯入前請先處理舊課程，避免重複。AI 辨識也可能出錯，請在匯出前確認時間與學期日期。"],
              ].map(([question, answer]) => (
                <article key={question} className="rounded-2xl border border-stone-200 bg-white p-6">
                  <h3 className="text-lg font-semibold text-stone-900">{question}</h3>
                  <p className="mt-3 text-sm leading-7 text-stone-600">{answer}</p>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-stone-200 bg-stone-50 px-6 py-10 text-stone-700">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
          <p className="text-sm text-stone-500">{t.home.footer}</p>
          <address className="not-italic text-base leading-7 text-stone-900">
            <p>
              <a
                className="underline decoration-stone-300 underline-offset-4 hover:text-indigo-700"
                href={`mailto:${supportEmail}`}
              >
                {emailLine}
              </a>
            </p>
          </address>
          <p className="max-w-2xl text-sm leading-7 text-stone-700">{pricingTerms}</p>
          <p className="text-xs font-mono tracking-wide text-neutral-400">
            v{version} · Build {BUILD_DATE}
          </p>
        </div>
      </footer>
    </div>
  );
}
