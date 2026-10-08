"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatPlanPrice, loadClientRates, type CurrencyCode } from "@/lib/currency";
import {
  compressScheduleImage,
  percentCropToPixels,
  type PixelRect,
} from "@/lib/imageCompressor";
import { getSampleCourses, localizeSampleCourses } from "@/lib/sampleSchedule";
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
const USAGE_UPDATED_EVENT = "cc-usage-updated";
const CURRENCY_EVENT = "cc-dev-currency";
const CURRENCY_KEY = "cc_dev_currency";

type PreviewFile = {
  id: string;
  file: File;
  previewUrl: string;
};

type Usage = {
  paid: boolean;
  parseCount: number;
  gpt4oCount: number;
  gpt4oRemaining: number;
  freeScansRemaining?: number;
  canExportIcs: boolean;
  model: string;
  token?: string;
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
  anchor.remove();
  URL.revokeObjectURL(url);
}

function persistUsage(usage: Usage) {
  if (usage.token && typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, usage.token);
  }
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
  const [usage, setUsage] = useState<Usage | null>(null);
  const { t, locale } = useI18n();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const [showPaywall, setShowPaywall] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState<"ecpay" | "stripe" | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [redeemNotice, setRedeemNotice] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [currencyOverride, setCurrencyOverride] = useState<CurrencyCode | null>(null);
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const [exportSuccessOpen, setExportSuccessOpen] = useState(false);
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

  const applyUsage = useCallback((next: Usage) => {
    persistUsage(next);
    setUsage(next);
    window.dispatchEvent(new CustomEvent(USAGE_UPDATED_EVENT));
  }, []);

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
    function onUsage(event: Event) {
      const detail = (event as CustomEvent<Usage>).detail;
      if (!detail?.token || typeof detail.paid !== "boolean") return;
      persistUsage(detail);
      setUsage(detail);
      if (detail.paid) setShowPaywall(false);
    }
    window.addEventListener(USAGE_UPDATED_EVENT, onUsage);
    return () => window.removeEventListener(USAGE_UPDATED_EVENT, onUsage);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const stored = window.localStorage.getItem(CURRENCY_KEY);
    if (stored === "TWD" || stored === "USD" || stored === "JPY" || stored === "EUR") {
      setCurrencyOverride(stored);
    }
    function onCurrency(event: Event) {
      const detail = (event as CustomEvent<CurrencyCode | null>).detail;
      setCurrencyOverride(detail ?? null);
    }
    window.addEventListener(CURRENCY_EVENT, onCurrency);
    return () => window.removeEventListener(CURRENCY_EVENT, onCurrency);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadUsage() {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("checkout") === "success" && params.get("session_id")) {
          const confirm = await fetch(
            `/api/checkout/confirm?session_id=${encodeURIComponent(params.get("session_id")!)}`,
            { headers: authHeaders() },
          );
          const confirmed = (await confirm.json()) as Usage & { error?: string };
          if (confirm.ok && !cancelled) {
            applyUsage(confirmed);
          }
          window.history.replaceState({}, "", window.location.pathname);
        }

        const response = await fetch("/api/user/usage", { headers: authHeaders() });
        const data = (await response.json()) as Usage;
        if (response.ok && !cancelled) applyUsage(data);
      } catch {
        /* keep anonymous local fallback */
      }
    }

    void loadUsage();
    return () => {
      cancelled = true;
    };
  }, [applyUsage]);

  const parseFiles = useCallback(async (images: File[]) => {
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
        const response = await fetch("/api/parse-schedule", {
          method: "POST",
          body: formData,
          headers: authHeaders(),
        });
        const data = (await response.json()) as {
          courses?: Course[];
          error?: string;
          usage?: Usage;
          requiresAuth?: boolean;
          requiresPayment?: boolean;
        };
        if (requestId !== parseRequestId.current) return;
        if (response.status === 401 || data.requiresAuth) {
          await signIn("google", { callbackUrl: "/#upload" });
          return;
        }
        if (response.status === 402 || data.requiresPayment) {
          if (data.usage) applyUsage(data.usage);
          setShowPaywall(true);
          throw new Error(data.error || t.upload.parseFailed);
        }
        if (!response.ok) {
          throw new Error(data.error || t.upload.parseFailed);
        }
        if (data.usage) applyUsage(data.usage);
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
  }, [applyUsage, t.upload.parseFailed]);

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      const valid = incoming.filter((file) => ACCEPTED_TYPES.includes(file.type));

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
      const compressed = await compressScheduleImage(current, source ?? undefined);
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

  async function handleDownload() {
    if (usage?.paid !== true) {
      setShowPaywall(true);
      return;
    }
    try {
      const response = await fetch("/api/export-ics", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ courses }),
      });
      if (response.status === 401) {
        await signIn("google", { callbackUrl: "/#upload" });
        return;
      }
      if (response.status === 402 || !response.ok) {
        setShowPaywall(true);
        return;
      }
      downloadIcsFile(await response.text());
      setExportSuccessOpen(true);
    } catch {
      setError(t.upload.icsError);
    }
  }

  async function startEcpayCheckout() {
    if (!signedIn) {
      await signIn("google", { callbackUrl: "/#upload" });
      return;
    }
    setCheckoutTarget("ecpay");
    setError(null);
    try {
      const response = await fetch("/api/checkout/ecpay", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ locale }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/html")) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || t.paywall.checkoutError);
      }
      const html = await response.text();
      document.open();
      document.write(html);
      document.close();
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : t.paywall.checkoutError,
      );
      setCheckoutTarget(null);
    }
  }

  async function startStripeCheckout() {
    if (!signedIn) {
      await signIn("google", { callbackUrl: "/#upload" });
      return;
    }
    setCheckoutTarget("stripe");
    setError(null);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ locale }),
      });
      const data = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!response.ok || !data?.url) {
        throw new Error(data?.error || t.paywall.checkoutError);
      }
      window.location.href = data.url;
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : t.paywall.checkoutError,
      );
      setCheckoutTarget(null);
    }
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
    try {
      const response = await fetch("/api/coupon/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ code: promoCode }),
      });
      const data = (await response.json().catch(() => null)) as (Usage & {
        error?: string;
        message?: string;
        requiresAuth?: boolean;
        isPaid?: boolean;
        usage?: Usage;
      }) | null;
      if (response.status === 401 || data?.requiresAuth || data?.error === "auth") {
        setPromoError("請先登入 Google 帳號後再進行兌換");
        return;
      }
      const paid = data?.paid === true || data?.isPaid === true || data?.usage?.paid === true;
      const token = data?.token || data?.usage?.token;
      if (!response.ok || !token || !paid) {
        setPromoError(data?.message || promoFailureMessage(data?.error));
        return;
      }
      persistUsage(data);
      setUsage(data);
      window.dispatchEvent(new CustomEvent(USAGE_UPDATED_EVENT, { detail: data }));
      setPromoCode("");
      setPromoOpen(false);
      setShowPaywall(false);
      setRedeemNotice(
        data.message?.trim() || (t.paywall.promoSuccess ?? "Redeemed."),
      );
    } catch {
      setPromoError(promoFailureMessage("unavailable"));
    } finally {
      setPromoLoading(false);
    }
  }

  const priceLabel = formatPlanPrice(locale, rates, currencyOverride);
  const withPrice = (text: string) => text.replaceAll("NT$9", priceLabel);

  return (
    <section
      id="upload"
      className="mx-auto w-full max-w-6xl scroll-mt-24"
      aria-labelledby="upload-heading"
    >
      {status === "unauthenticated" ? (
        <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4 sm:px-5">
          <p className="text-sm font-semibold leading-6 text-indigo-950">
            <span aria-hidden>✨ </span>
            {t.upload.freeScanCta ?? "Sign in with Google to get 3 free AI schedule scans"}
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
            <p className="mt-4 text-sm font-medium text-stone-800">{t.upload.parsing}</p>
            <p className="mt-1 text-sm text-stone-500">{t.upload.parsingHint}</p>
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
          <span id="upload-heading" className="text-lg font-semibold text-stone-900">
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
                    <p className="text-xs text-stone-500">{formatBytes(file.file.size)}</p>
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
          {t.upload.sampleDataPrompt ?? "No schedule? Click here to try with sample data"}
        </button>
      </div>

      {courses.length > 0 ? (
        <div
          ref={calendarRef}
          className="mt-8 scroll-mt-24 overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm"
        >
          <div className="flex flex-col gap-3 border-b border-stone-200 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-stone-900">{t.upload.weeklyTitle}</h2>
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
                    usage?.paid === true
                      ? "bg-indigo-600 text-white hover:bg-indigo-500"
                      : "bg-stone-200 text-stone-500"
                  }`}
                >
                  {usage?.paid === true ? (
                    t.upload.download
                  ) : (
                    <>
                      <span aria-hidden>🔒</span>
                      {t.upload.downloadLocked}
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
                {usage?.paid
                  ? withPrice(t.upload.planPaid(usage.gpt4oRemaining))
                  : withPrice(t.upload.planFree)}
              </p>
            </div>
          </div>
          <WeeklyCalendar key={calendarKey} courses={courses} onChange={setCourses} />
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
        <ExportSuccessModal courses={courses} onClose={() => setExportSuccessOpen(false)} />
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
              percentCropToPixels(crop, image.naturalWidth, image.naturalHeight),
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
          onClick={() => setShowPaywall(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-labelledby="paywall-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p id="paywall-title" className="text-lg font-semibold text-stone-900">
              {t.paywall.title}
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-600">{withPrice(t.paywall.offer)}</p>
            <p className="mt-3 text-sm text-stone-500">{withPrice(t.paywall.body)}</p>
            {!signedIn ? (
              <button
                type="button"
                onClick={() => void signIn("google", { callbackUrl: "/#upload" })}
                className="mt-5 w-full rounded-full bg-stone-900 px-4 py-3 text-sm font-medium text-white hover:bg-stone-800"
              >
                {t.nav.signIn}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={checkoutTarget !== null}
                  onClick={() => void startEcpayCheckout()}
                  className="mt-5 w-full rounded-full bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {checkoutTarget === "ecpay" ? t.paywall.paying : t.paywall.pay}
                </button>
                <button
                  type="button"
                  disabled={checkoutTarget !== null}
                  onClick={() => void startStripeCheckout()}
                  className="mt-2 w-full rounded-full border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:opacity-60"
                >
                  {checkoutTarget === "stripe"
                    ? (t.paywall.payingStripe ?? "Redirecting to Stripe…")
                    : (t.paywall.payStripe ?? "Pay NT$9 with Stripe")}
                </button>
              </>
            )}
            <div className="mt-4 border-t border-stone-100 pt-3">
              <button
                type="button"
                aria-expanded={promoOpen}
                onClick={() => {
                  setPromoOpen((open) => !open);
                  setPromoError(null);
                }}
                className="text-sm font-medium text-indigo-700 hover:text-indigo-500"
              >
                {t.paywall.promoLabel ?? "Enter Promo Code"}
              </button>
              {promoOpen ? (
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
                    placeholder={t.paywall.promoPlaceholder ?? "Promo code"}
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
              onClick={() => setShowPaywall(false)}
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
