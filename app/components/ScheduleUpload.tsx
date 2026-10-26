"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatPlanPrice,
  loadClientRates,
  type CurrencyCode,
} from "@/lib/currency";
import {
  compressScheduleImage,
  percentCropToPixels,
  type PixelRect,
} from "@/lib/imageCompressor";
import { getSampleCourses, localizeSampleCourses } from "@/lib/sampleSchedule";
import CheckoutRecovery, { useCheckoutRecovery } from "./CheckoutRecovery";
import type { PaymentProvider } from "@/lib/checkout-recovery";
import { useEntitlements, EntitlementStatus } from "./EntitlementDisplay";
import AccountActivity from "./AccountActivity";
import ExportSuccessModal from "./ExportSuccessModal";
import ScheduleCropModal from "./ScheduleCropModal";
import AddCourseModal from "./AddCourseModal";
import type { Course } from "@/lib/types";
import { useSession, signIn } from "next-auth/react";
import { useI18n } from "@/lib/i18n";
import WeeklyCalendar from "./WeeklyCalendar";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const TOKEN_HEADER = "x-cc-token";
const STORAGE_KEY = "cc_entitlement_token";
const OPEN_PAYWALL_EVENT = "cc-open-paywall";
const CURRENCY_EVENT = "cc-dev-currency";
const CURRENCY_KEY = "cc_dev_currency";

type PreviewFile = {
  id: string;
  file: File;
  previewUrl: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadIcsFile(ics: string, filename = "course-schedule.ics") {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function EmphasizedText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem(STORAGE_KEY);
  return token ? { [TOKEN_HEADER]: token } : {};
}

export default function ScheduleUpload() {
  const { data: session, status } = useSession();
  return (
    <ScheduleUploadScreen
      key={session?.user?.id || session?.user?.email || status}
    />
  );
}

function ScheduleUploadScreen() {
  const inputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const scrollToCalendar = useRef(false);
  const showingSample = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [calendarKey, setCalendarKey] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { state: entitlement, store: entitlementStore } = useEntitlements();
  const usage = entitlement.snapshot;
  const { t, locale } = useI18n();
  const { status, data: session } = useSession();
  const signedIn = status === "authenticated";
  const accountId = session?.user?.id || session?.user?.email || "";
  const [showPaywall, setShowPaywall] = useState(false);
  const [showPromoInput, setShowPromoInput] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [redeemNotice, setRedeemNotice] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [currencyOverride, setCurrencyOverride] = useState<CurrencyCode | null>(
    null,
  );
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const [exportSuccessOpen, setExportSuccessOpen] = useState(false);
  const [exportedIcs, setExportedIcs] = useState("");
  const [addCourseOpen, setAddCourseOpen] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const preparedBatch = useRef<File[]>([]);

  const parseRequestId = useRef(0);

  useEffect(() => {
    if (!scrollToCalendar.current || courses.length === 0) return;
    scrollToCalendar.current = false;
    calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [courses]);

  useEffect(() => {
    if (!showingSample.current) return;
    setCourses((current) => localizeSampleCourses(current, locale));
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    loadClientRates().then((next) => {
      if (!cancelled && next) setRates(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function loadSampleSchedule() {
    setError(null);
    scrollToCalendar.current = true;
    showingSample.current = true;
    setCourses(getSampleCourses(locale));
  }

  const checkout = useCheckoutRecovery(accountId);
  const checkoutTarget = checkout.state.starting;

  useEffect(() => {
    if (!redeemNotice) return;
    const timer = window.setTimeout(() => setRedeemNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [redeemNotice]);

  useEffect(() => {
    function onOpenPaywall() {
      setShowPaywall(true);
    }
    window.addEventListener(OPEN_PAYWALL_EVENT, onOpenPaywall);
    return () => window.removeEventListener(OPEN_PAYWALL_EVENT, onOpenPaywall);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const stored = window.localStorage.getItem(CURRENCY_KEY);
    if (
      stored === "TWD" ||
      stored === "USD" ||
      stored === "JPY" ||
      stored === "EUR"
    ) {
      queueMicrotask(() => setCurrencyOverride(stored));
    }
    function onCurrency(event: Event) {
      const detail = (event as CustomEvent<CurrencyCode | null>).detail;
      setCurrencyOverride(detail ?? null);
    }
    window.addEventListener(CURRENCY_EVENT, onCurrency);
    return () => window.removeEventListener(CURRENCY_EVENT, onCurrency);
  }, []);

  const parseFiles = useCallback(
    async (images: File[]) => {
      if (images.length === 0) return;

      const requestId = ++parseRequestId.current;
      showingSample.current = false;
      setCalendarKey((key) => key + 1);
      setCourses([]);
      setExportSuccessOpen(false);
      setIsParsing(true);
      setError(null);

      try {
        const nextCourses: Course[] = [];
        for (const image of images) {
          const formData = new FormData();
          formData.append("image", image);
          const fingerprint = Array.from(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", await image.arrayBuffer()),
            ),
          )
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const pendingKey = `cc_pending_job:${accountId}:${fingerprint}`;
          // Keep uncertain submissions across reloads. Only a confirmed terminal
          // response removes this reference, allowing a deliberate new attempt.
          let jobId = window.localStorage.getItem(pendingKey);
          if (!jobId) {
            jobId = crypto.randomUUID();
            window.localStorage.setItem(pendingKey, jobId);
          }
          if (requestId !== parseRequestId.current) return;
          formData.append("jobId", jobId);
          const operation = entitlementStore.beginOperation();
          let response: Response;
          let data: {
            courses?: Course[];
            error?: string;
            usage?: unknown;
            requiresAuth?: boolean;
            requiresPayment?: boolean;
          };
          try {
            response = await fetch("/api/parse-schedule", {
              method: "POST",
              body: formData,
              headers: authHeaders(),
            });
            data = await response.json();
          } catch (error) {
            void operation.finish(undefined, 0);
            throw error;
          }
          void operation.finish(
            data.usage,
            data.requiresAuth ? 401 : response.status,
          );
          if (requestId !== parseRequestId.current) return;
          if (response.status === 202) {
            throw new Error(
              "此工作仍在辨識中，請從最近辨識查看結果，無須重新送出。",
            );
          }
          if (
            response.ok ||
            response.status === 409 ||
            response.status === 422 ||
            response.status === 402
          )
            window.localStorage.removeItem(pendingKey);
          if (response.status === 401 || data.requiresAuth) {
            await signIn("google", { callbackUrl: "/#upload" });
            return;
          }
          if (response.status === 402 || data.requiresPayment) {
            setShowPaywall(true);
            throw new Error(data.error || t.upload.parseFailed);
          }
          if (!response.ok) {
            if (![409, 422, 402].includes(response.status)) {
              try {
                const check = await fetch(
                  `/api/recognition/jobs?id=${encodeURIComponent(jobId)}`,
                );
                if (check.ok) {
                  const saved = await check.json();
                  if (
                    saved.jobs?.[0]?.state === "failed" ||
                    saved.jobs?.[0]?.state === "expired"
                  )
                    window.localStorage.removeItem(pendingKey);
                }
              } catch {
                /* Keep the concrete failure and uncertain job reference. */
              }
            }
            throw new Error(data.error || t.upload.parseFailed);
          }
          nextCourses.push(
            ...(data.courses ?? []).map((course) => ({
              ...course,
              slots: course.slots || [],
            })),
          );
        }
        if (requestId !== parseRequestId.current) return;
        setCourses(nextCourses);
      } catch (parseError) {
        if (requestId !== parseRequestId.current) return;
        setCourses([]);
        setError(
          parseError instanceof Error
            ? parseError.message
            : t.upload.parseFailed,
        );
      } finally {
        if (requestId === parseRequestId.current) {
          setIsParsing(false);
        }
      }
    },
    [entitlementStore, t.upload.parseFailed, accountId],
  );

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      const valid = incoming.filter((file) =>
        ACCEPTED_TYPES.includes(file.type),
      );

      if (valid.length === 0) {
        setError(t.upload.invalidType);
        return;
      }

      setError(null);
      setCropQueue((current) => [...current, ...valid]);
    },
    [t.upload.invalidType],
  );

  async function acceptCrop(source: PixelRect | null) {
    const current = cropQueue[0];
    if (!current || isCompressing) return;
    setIsCompressing(true);
    setError(null);
    try {
      const compressed = await compressScheduleImage(
        current,
        source ?? undefined,
      );
      preparedBatch.current.push(compressed);
    } catch {
      setError(t.upload.parseFailed);
    } finally {
      setIsCompressing(false);
    }
    const rest = cropQueue.slice(1);
    setCropQueue(rest);
    if (rest.length > 0) return;
    const batch = preparedBatch.current.splice(0);
    if (batch.length === 0) return;
    setFiles((existing) => [
      ...existing,
      ...batch.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
    void parseFiles(batch);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length) {
      addFiles(event.dataTransfer.files);
    }
  }

  function removeFile(id: string) {
    setFiles((current) => {
      const target = current.find((file) => file.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const remaining = current.filter((file) => file.id !== id);
      if (remaining.length === 0) {
        showingSample.current = false;
        setCourses([]);
      }
      return remaining;
    });
  }

  async function exportCalendar() {
    try {
      const response = await fetch("/api/export-ics", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ courses }),
      });
      if (response.status === 401) {
        entitlementStore.requireSignIn();
        await signIn("google", { callbackUrl: "/#upload" });
        return;
      }
      if (response.status === 402) {
        setShowPaywall(true);
        return;
      }
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t.upload.icsError);
      }
      const ics = await response.text();
      setExportedIcs(ics);
      downloadIcsFile(ics);
      setExportSuccessOpen(true);
    } catch {
      setError(t.upload.icsError);
    }
  }

  function handleDownload() {
    // The backend confirms eligibility even when the display snapshot is unavailable.
    void exportCalendar();
  }

  const lastCheckoutProvider = useRef<PaymentProvider>("ecpay");
  async function startCheckout(provider: PaymentProvider) {
    lastCheckoutProvider.current = provider;
    await checkout.start(provider, courses, locale);
    setShowPaywall(false);
  }

  async function continueWithoutDraft() {
    if (
      !window.confirm(
        locale.startsWith("zh")
          ? "不保存課表就繼續付款，返回後可能無法恢復。確定繼續？"
          : "Continue without saving? Your schedule may not be recoverable after payment.",
      )
    )
      return;
    await checkout.start(lastCheckoutProvider.current, courses, locale, true);
  }

  function promoFailureMessage(error?: string) {
    if (error === "auth") return "請先登入 Google 帳號後再進行兌換";
    return t.paywall.promoInvalid ?? "優惠碼無效或已被使用";
  }

  async function redeemPromo() {
    if (!promoCode.trim()) {
      setPromoError(promoFailureMessage("inactive"));
      return;
    }
    setPromoLoading(true);
    setPromoError(null);
    const operation = entitlementStore.beginOperation();
    try {
      const response = await fetch("/api/coupon/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ code: promoCode, site_id: "course-copilot" }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        requiresAuth?: boolean;
        redeemed?: boolean;
        isPaid?: boolean;
      } | null;
      void operation.finish(
        response.ok ? (data ?? undefined) : undefined,
        data?.requiresAuth ? 401 : response.status,
      );
      if (
        response.status === 401 ||
        data?.requiresAuth ||
        data?.error === "auth"
      ) {
        setPromoError("請先登入 Google 帳號後再進行兌換");
        return;
      }
      if (!response.ok || !data || !(data.redeemed || data.isPaid)) {
        setPromoError(data?.message || promoFailureMessage(data?.error));
        return;
      }
      setPromoCode("");
      setShowPromoInput(false);
      setShowPaywall(false);
      setRedeemNotice(
        data.message?.trim() || (t.paywall.promoSuccess ?? "Redeemed."),
      );
    } catch {
      setPromoError(promoFailureMessage("unavailable"));
    } finally {
      void operation.finish(undefined, 0);
      setPromoLoading(false);
    }
  }

  function restoreSchedule(restored: Course[]) {
    parseRequestId.current += 1;
    showingSample.current = false;
    setIsParsing(false);
    setCourses(restored);
    setCalendarKey((current) => current + 1);
  }

  const priceLabel = formatPlanPrice(locale, rates, currencyOverride);
  const withPrice = (text: string) => text.replaceAll("NT$9", priceLabel);

  return (
    <section
      id="upload"
      className="mx-auto w-full max-w-6xl scroll-mt-24"
      aria-labelledby="upload-heading"
    >
      <EntitlementStatus />
      {usage ? (
        <p aria-label="帳號權益摘要" className="mb-3 text-sm text-stone-600">
          {locale.startsWith("zh")
            ? `免費 ${usage.freeRemaining} 次 · 購買／兌換 ${usage.creditRemaining} 次 · 共 ${usage.totalRemaining} 次 · ${usage.canExport ? "可匯出行事曆" : "尚無匯出資格"}`
            : `Free ${usage.freeRemaining} · Purchased/redeemed ${usage.creditRemaining} · Total ${usage.totalRemaining} · ${usage.canExport ? "Calendar export unlocked" : "Calendar export locked"}`}
        </p>
      ) : null}
      <>
        {checkout.state.problem === "save" ? (
          <div className="flex gap-4 text-sm">
            <button
              type="button"
              className="underline"
              onClick={() => void startCheckout(lastCheckoutProvider.current)}
            >
              {locale.startsWith("zh")
                ? "重試保存並付款"
                : "Retry saving and checkout"}
            </button>
            <button
              type="button"
              className="underline"
              onClick={() => void continueWithoutDraft()}
            >
              {locale.startsWith("zh")
                ? "不保存課表，繼續付款"
                : "Continue without saving"}
            </button>
          </div>
        ) : null}
        <CheckoutRecovery
          checkout={checkout}
          courses={courses}
          locale={locale}
          onRestore={restoreSchedule}
        />
        {signedIn && (
          <AccountActivity
            key={session?.user?.id || session?.user?.email}
            restore={restoreSchedule}
          />
        )}
      </>
      {status === "unauthenticated" ? (
        <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4 sm:px-5">
          <p className="text-sm font-semibold leading-6 text-indigo-950">
            <span aria-hidden>✨ </span>
            {t.upload.freeScanCta ??
              "Sign in with Google to get 3 free AI schedule scans"}
          </p>
          <button
            type="button"
            onClick={() => void signIn("google", { callbackUrl: "/#upload" })}
            className="mt-3 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            {t.nav.signIn}
          </button>
        </div>
      ) : null}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`relative rounded-3xl border-2 border-dashed bg-white p-6 shadow-sm transition sm:p-8 ${
          isDragging
            ? "border-indigo-500 bg-indigo-50"
            : "border-stone-300 hover:border-indigo-400"
        }`}
      >
        {isParsing ? (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-3xl bg-white/85 backdrop-blur-[1px]"
            role="status"
            aria-live="polite"
          >
            <span className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
            <p className="mt-4 text-sm font-medium text-stone-800">
              {t.upload.parsing}
            </p>
            <p className="mt-1 text-sm text-stone-500">
              {t.upload.parsingHint}
            </p>
          </div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept="image/*,image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          disabled={isParsing}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <button
          type="button"
          disabled={isParsing}
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-3 rounded-2xl px-4 py-10 text-center disabled:opacity-60"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl">
            📅
          </span>
          <span
            id="upload-heading"
            className="text-lg font-semibold text-stone-900"
          >
            {t.upload.heading}
          </span>
          <span className="max-w-md text-sm leading-6 text-stone-500">
            {t.upload.hint}
          </span>
          <span className="mt-2 inline-flex rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
            {t.upload.chooseFiles}
          </span>
        </button>

        {error ? (
          <p className="mt-2 text-center text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {files.length > 0 ? (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={file.previewUrl}
                  alt={t.upload.previewAlt(file.file.name)}
                  className="h-40 w-full object-cover"
                />
                <div className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-800">
                      {file.file.name}
                    </p>
                    <p className="text-xs text-stone-500">
                      {formatBytes(file.file.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(file.id)}
                    disabled={isParsing}
                    className="shrink-0 rounded-full px-2 py-1 text-xs text-stone-500 hover:bg-white hover:text-stone-800 disabled:opacity-50"
                  >
                    {t.upload.remove}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {files.length > 0 && !isParsing && courses.length === 0 && !error ? (
          <p className="mt-4 text-center text-sm text-stone-500">
            {t.upload.empty}
          </p>
        ) : null}

        {files.length > 0 && !isParsing ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => void parseFiles(files.map((item) => item.file))}
              className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              {t.upload.parseAgain}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={loadSampleSchedule}
          className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          {t.upload.sampleDataPrompt ??
            "No schedule? Click here to try with sample data"}
        </button>
      </div>

      {courses.length > 0 ? (
        <div
          ref={calendarRef}
          className="mt-8 scroll-mt-24 overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm"
        >
          <div className="flex flex-col gap-3 border-b border-stone-200 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-stone-900">
                {t.upload.weeklyTitle}
              </h2>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddCourseOpen(true)}
                  className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-white dark:text-slate-700 dark:hover:bg-slate-50"
                >
                  {t.upload.addCourse ?? "+ Add course"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownload()}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium ${
                    usage?.canExport === true
                      ? "bg-indigo-600 text-white hover:bg-indigo-500"
                      : "bg-stone-200 text-stone-500"
                  }`}
                >
                  {usage?.canExport === true ? (
                    t.upload.download
                  ) : (
                    <>
                      <span aria-hidden>🔒</span>
                      {entitlement.status === "ready"
                        ? t.upload.downloadLocked
                        : locale.startsWith("zh")
                          ? "確認資格並下載"
                          : "Verify eligibility and download"}
                    </>
                  )}
                </button>
              </div>
            </div>
            <div role="note">
              <p className="text-sm text-amber-500">
                <EmphasizedText text={t.upload.weeklyHint} />
              </p>
              <p className="mt-1 text-sm font-semibold text-amber-600">
                {usage?.canExport
                  ? withPrice(t.upload.planPaid(usage.totalRemaining))
                  : withPrice(t.upload.planFree)}
              </p>
            </div>
          </div>
          <WeeklyCalendar
            key={calendarKey}
            courses={courses}
            onChange={setCourses}
          />
        </div>
      ) : null}

      {addCourseOpen ? (
        <AddCourseModal
          onClose={() => setAddCourseOpen(false)}
          onAdd={(course) => {
            setCourses((current) => [...current, course]);
            setAddCourseOpen(false);
          }}
        />
      ) : null}

      {exportSuccessOpen ? (
        <ExportSuccessModal
          courses={courses}
          ics={exportedIcs}
          onClose={() => setExportSuccessOpen(false)}
        />
      ) : null}

      {cropQueue[0] ? (
        <ScheduleCropModal
          file={cropQueue[0]}
          title={t.upload.cropTitle ?? "Crop the schedule"}
          hint={
            t.upload.cropHint ??
            "Select the schedule table itself. Leave out the top tabs and the bottom toolbar for the most accurate result."
          }
          confirmLabel={t.upload.cropConfirm ?? "Crop and parse"}
          skipLabel={t.upload.cropSkip ?? "Use the full image"}
          busy={isCompressing}
          onSkip={() => void acceptCrop(null)}
          onConfirm={(crop, image) =>
            void acceptCrop(
              percentCropToPixels(
                crop,
                image.naturalWidth,
                image.naturalHeight,
              ),
            )
          }
        />
      ) : null}

      {redeemNotice ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[70] max-w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl bg-stone-900 px-4 py-3 text-center text-sm text-white shadow-lg"
        >
          {redeemNotice}
        </div>
      ) : null}

      {showPaywall ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
          onClick={() => {
            setShowPaywall(false);
            setShowPromoInput(false);
            setPromoError(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-labelledby="paywall-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p
              id="paywall-title"
              className="text-lg font-semibold text-stone-900"
            >
              {t.paywall.title}
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {withPrice(t.paywall.offer)}
            </p>
            <p className="mt-3 text-sm text-stone-500">
              {withPrice(t.paywall.body)}
            </p>
            {!signedIn ? (
              <button
                type="button"
                onClick={() =>
                  void signIn("google", { callbackUrl: "/#upload" })
                }
                className="mt-5 w-full rounded-full bg-stone-900 px-4 py-3 text-sm font-medium text-white hover:bg-stone-800"
              >
                {t.nav.signIn}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={checkoutTarget !== null}
                  onClick={() => void startCheckout("ecpay")}
                  className="mt-5 w-full rounded-full bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {checkoutTarget === "ecpay"
                    ? t.paywall.paying
                    : t.paywall.pay}
                </button>
                {usage?.stripeCheckoutEnabled ? (
                  <button
                    type="button"
                    disabled={checkoutTarget !== null}
                    onClick={() => void startCheckout("stripe")}
                    className="mt-2 w-full rounded-full border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:opacity-60"
                  >
                    {checkoutTarget === "stripe"
                      ? (t.paywall.payingStripe ?? "Redirecting to Stripe…")
                      : (t.paywall.payStripe ?? "Pay NT$9 with Stripe")}
                  </button>
                ) : null}
              </>
            )}
            <div className="mt-4 border-t border-stone-100 pt-3">
              <button
                type="button"
                aria-expanded={showPromoInput}
                onClick={() => {
                  setShowPromoInput((open) => !open);
                  setPromoError(null);
                }}
                className="cursor-pointer text-sm text-slate-500 underline transition-colors hover:text-slate-800"
              >
                {showPromoInput
                  ? (t.paywall.promoCollapse ?? "收合優惠碼")
                  : (t.paywall.promoToggle ?? "有優惠碼？點此兌換")}
              </button>
              {showPromoInput ? (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void redeemPromo();
                  }}
                >
                  <input
                    value={promoCode}
                    onChange={(event) => {
                      setPromoCode(event.target.value);
                      setPromoError(null);
                    }}
                    placeholder={t.paywall.promoPlaceholder ?? "優惠碼"}
                    aria-label={t.paywall.promoLabel ?? "Enter Promo Code"}
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-full border border-stone-300 px-4 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
                  />
                  <button
                    type="submit"
                    disabled={promoLoading}
                    className="shrink-0 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
                  >
                    {t.paywall.promoRedeem ?? "Redeem"}
                  </button>
                </form>
              ) : null}
              {promoError ? (
                <p className="mt-2 text-sm text-red-600" role="alert">
                  {promoError}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowPaywall(false);
                setShowPromoInput(false);
                setPromoError(null);
              }}
              className="mt-2 w-full rounded-full px-4 py-2 text-sm text-stone-500 hover:bg-stone-50"
            >
              {t.paywall.keepFree}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
