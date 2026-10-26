"use client";

import { isCourseStructure, inspectSchedule } from "@/lib/course-time";

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
import RecognitionBatch, { useRecognitionBatch } from "./RecognitionBatch";
import AccountActivity from "./AccountActivity";
import CalendarExportStatus, { useCalendarExport } from "./CalendarExport";
import ExportSuccessModal from "./ExportSuccessModal";
import ScheduleCropModal from "./ScheduleCropModal";
import AddCourseModal from "./AddCourseModal";
import ScheduleDraft from "./ScheduleDraft";
import Modal from "./Modal";
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
  const [sampleBackup, setSampleBackup] = useState<Course[] | null>(null);
  const [calendarKey, setCalendarKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { state: entitlement, store: entitlementStore } = useEntitlements();
  const usage = entitlement.snapshot;
  const { t, locale } = useI18n();
  const { status, data: session } = useSession();
  const signedIn = status === "authenticated";
  const accountId = session?.user?.id || session?.user?.email || "";
  const batch = useRecognitionBatch(accountId);
  const isParsing = batch.state.phase === "running";
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
  const [cropQueue, setCropQueue] = useState<{ id: string; file: File }[]>([]);
  const openPayment = useCallback(() => setShowPaywall(true), []);
  const calendarExport = useCalendarExport(accountId, openPayment);
  const [addCourseOpen, setAddCourseOpen] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const previews = useRef<string[]>([]);
  useEffect(
    () => () => previews.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );

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
    if (!showingSample.current && courses.length)
      setSampleBackup(structuredClone(courses));
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

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const valid = Array.from(fileList).filter((file) =>
        ACCEPTED_TYPES.includes(file.type),
      );
      if (!valid.length) {
        setError(t.upload.invalidType);
        return;
      }
      if (!batch.flow.open(valid.map((file) => file.name))) {
        setError("請先完成或結束目前辨識批次，新圖片尚未加入。");
        return;
      }
      previews.current.forEach((url) => URL.revokeObjectURL(url));
      previews.current = [];
      setFiles([]);
      setError(null);
      const items = batch.flow.getSnapshot().items;
      setCropQueue(valid.map((file, index) => ({ id: items[index].id, file })));
    },
    [batch.flow, t.upload.invalidType],
  );
  async function acceptCrop(source: PixelRect | null) {
    const current = cropQueue[0];
    if (!current || isCompressing) return;
    setIsCompressing(true);
    setError(null);
    try {
      const compressed = await compressScheduleImage(
        current.file,
        source ?? undefined,
      );
      // A finished or replaced batch must not accept a late preparation result.
      if (!batch.flow.getSnapshot().items.some((i) => i.id === current.id))
        return;
      batch.flow.prepared(current.id, compressed);
      const previewUrl = URL.createObjectURL(compressed);
      previews.current.push(previewUrl);
      setFiles((existing) => [
        ...existing,
        { id: current.id, file: compressed, previewUrl },
      ]);
      const rest = cropQueue.slice(1);
      setCropQueue(rest);
      if (!rest.length) void batch.flow.continue();
    } catch {
      batch.flow.preparationFailed(current.id);
      setError("圖片準備失敗，尚未送出。請重試、略過這張或取消這批。");
    } finally {
      setIsCompressing(false);
    }
  }
  function discardPreparation() {
    const current = cropQueue[0];
    if (!current || isCompressing) return;
    batch.flow.skip(current.id);
    setError(null);
    const rest = cropQueue.slice(1);
    setCropQueue(rest);
    if (!rest.length) void batch.flow.continue();
  }
  function endPreparation() {
    batch.flow.end();
    setCropQueue([]);
    setError(null);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length) {
      addFiles(event.dataTransfer.files);
    }
  }

  function handleDownload() {
    void calendarExport.flow.start(courses);
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
    if (!isCourseStructure(restored)) {
      setError("課表結構無法辨認，無法載入");
      return;
    }
    showingSample.current = false;
    setCourses(inspectSchedule(restored).courses);
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

      <p className="my-3 text-sm text-stone-500">
        {locale.startsWith("zh")
          ? "圖片與整批進度僅保留在此頁。重整後需重新選圖；已成功的單張結果可從最近辨識取回（7 天內）。"
          : "Images and batch progress stay in this page only. Reselect after reload; successful jobs remain in recent recognition for seven days."}
      </p>
      <RecognitionBatch
        batch={batch}
        courses={courses}
        locale={locale}
        onLoad={restoreSchedule}
        onEnd={() => {
          setCropQueue([]);
          setFiles([]);
          setError(null);
          previews.current.forEach((url) => URL.revokeObjectURL(url));
          previews.current = [];
        }}
      />
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
                </div>
              </li>
            ))}
          </ul>
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

      {sampleBackup ? (
        <div role="status" className="my-3 text-sm">
          {locale.startsWith("zh")
            ? "已載入範例；原課表仍可復原。"
            : "Sample loaded. Your previous schedule can be restored."}
          <button
            type="button"
            className="ml-3 min-h-11 underline"
            onClick={() => {
              showingSample.current = false;
              setCourses(sampleBackup);
              setSampleBackup(null);
            }}
          >
            {locale.startsWith("zh")
              ? "復原範例替換"
              : "Undo sample replacement"}
          </button>
        </div>
      ) : null}
      <ScheduleDraft
        accountId={accountId}
        courses={showingSample.current && sampleBackup ? sampleBackup : courses}
        onRestore={restoreSchedule}
        zh={locale.startsWith("zh")}
      />
      <CalendarExportStatus flow={calendarExport.flow} courses={courses} />
      {courses.length === 0 ? (
        <button
          type="button"
          className="mt-4 rounded-full border px-4 py-2"
          data-modal-return
          onClick={() => setAddCourseOpen(true)}
        >
          {t.upload.addCourse ?? "+ Add course"}
        </button>
      ) : null}
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
                  data-modal-return
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
            onChange={(next) => {
              showingSample.current = false;
              setCourses(next);
            }}
          />
        </div>
      ) : null}

      {addCourseOpen ? (
        <AddCourseModal
          onClose={() => setAddCourseOpen(false)}
          onAdd={(course) => {
            showingSample.current = false;
            setCourses((current) => [...current, course]);
            setAddCourseOpen(false);
          }}
        />
      ) : null}

      {calendarExport.state.open && calendarExport.state.result ? (
        <ExportSuccessModal
          flow={calendarExport.flow}
          previousVersion={!calendarExport.flow.matches(courses)}
        />
      ) : null}

      {cropQueue[0] ? (
        <ScheduleCropModal
          file={cropQueue[0].file}
          error={error}
          onDiscard={discardPreparation}
          onCancel={endPreparation}
          discardLabel={
            locale.startsWith("zh") ? "略過這張圖片" : "Skip this image"
          }
          cancelLabel={locale.startsWith("zh") ? "取消這批" : "Cancel batch"}
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
        <Modal
          labelledBy="paywall-title"
          className="w-full max-w-md bg-white p-6"
          onClose={() => {
            setShowPaywall(false);
            setShowPromoInput(false);
            setPromoError(null);
          }}
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
                onClick={() => void startCheckout("ecpay")}
                className="mt-5 w-full rounded-full bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {checkoutTarget === "ecpay" ? t.paywall.paying : t.paywall.pay}
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
        </Modal>
      ) : null}
    </section>
  );
}
