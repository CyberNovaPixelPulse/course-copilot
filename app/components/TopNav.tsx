"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { LOCALES, useI18n, type Dictionary, type Locale } from "@/lib/i18n";

const TOKEN_HEADER = "x-cc-token";
const STORAGE_KEY = "cc_entitlement_token";
const OPEN_PAYWALL_EVENT = "cc-open-paywall";
const USAGE_UPDATED_EVENT = "cc-usage-updated";

type CreditUsage = {
  paid: boolean;
  gpt4oRemaining: number;
  freeScansRemaining?: number;
};

type CreditBadge = {
  mode: "paid" | "free" | "guest";
  count: number;
};

function creditText(t: Dictionary, credits: CreditBadge) {
  if (credits.mode === "free") {
    return (t.nav.freeCredits ?? ((count: number) => `Free scans: ${count}`))(credits.count);
  }
  return (t.nav.credits ?? ((count: number) => `Credits: ${count}`))(credits.count);
}

function UserAvatar({
  image,
  name,
  className,
}: {
  image?: string | null;
  name: string;
  className: string;
}) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image} alt="" className={`${className} rounded-full object-cover ring-1 ring-stone-200`} />
    );
  }
  return (
    <span
      className={`${className} flex items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function LanguageList({
  id,
  label,
  locale,
  setLocale,
  onPick,
}: {
  id: string;
  label: string;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  onPick?: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [locale]);

  return (
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      aria-label={label}
      className="language-menu max-h-52 overflow-y-auto rounded-2xl border border-stone-200 bg-white py-1 text-left"
      dir="ltr"
    >
      {LOCALES.map((item) => {
        const selected = item.code === locale;
        return (
          <li key={item.code} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                setLocale(item.code);
                onPick?.();
              }}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-stone-50 ${
                selected ? "bg-indigo-50 text-indigo-900" : "text-stone-800"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.native}</span>
                <span className="block truncate text-xs text-stone-500">{item.english}</span>
              </span>
              {selected ? (
                <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden>
                  <path
                    fill="currentColor"
                    d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.2 7.2a1 1 0 0 1-1.4 0L3.3 9.1a1 1 0 1 1 1.4-1.4l3.1 3.1 6.5-6.5a1 1 0 0 1 1.4 0Z"
                  />
                </svg>
              ) : (
                <span className="h-4 w-4 shrink-0" aria-hidden />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function LanguageMenu({
  label,
  locale,
  setLocale,
}: {
  label: string;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = LOCALES.find((item) => item.code === locale) ?? LOCALES[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        id="language-switcher"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="language-menu"
        aria-label={label}
        title={`${current.native} (${current.english})`}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 max-w-[11rem] items-center gap-1 rounded-full border border-stone-200 bg-white px-3 text-sm text-stone-700"
      >
        <span className="truncate">{current.native}</span>
        <span aria-hidden className="text-[10px] text-stone-400">
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(18rem,calc(100vw-1.5rem))] shadow-lg">
          <LanguageList
            id="language-menu"
            label={label}
            locale={locale}
            setLocale={setLocale}
            onPick={() => setOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuButton({
  label,
  expanded,
  onClick,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl text-stone-800 hover:bg-stone-100"
    >
      ☰
    </button>
  );
}

export default function TopNav() {
  const { data: session, status } = useSession();
  const { t, locale, setLocale } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = status === "authenticated";
  const [credits, setCredits] = useState<CreditBadge | null>(null);
  const displayName = session?.user?.name || session?.user?.email || "U";
  const creditLabel = credits ? creditText(t, credits) : "";

  const navLinks = [
    { href: "/", label: t.nav.home },
    { href: "/#upload", label: t.nav.upload },
    { href: "/#how-it-works", label: t.nav.howItWorks },
  ];

  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;

    async function loadCredits() {
      try {
        const token = window.localStorage.getItem(STORAGE_KEY);
        const headers: HeadersInit = token ? { [TOKEN_HEADER]: token } : {};
        const response = await fetch("/api/user/usage", { headers });
        if (!response.ok) return;
        const data = (await response.json()) as CreditUsage;
        if (!cancelled) applyCreditData(data);
      } catch {
        if (!cancelled) setCredits({ mode: status === "authenticated" ? "free" : "guest", count: 0 });
      }
    }

    function applyCreditData(data: CreditUsage) {
      if (data.paid) {
        setCredits({ mode: "paid", count: data.gpt4oRemaining });
      } else if (status === "authenticated") {
        setCredits({ mode: "free", count: data.freeScansRemaining ?? 0 });
      } else {
        setCredits({ mode: "guest", count: 0 });
      }
    }

    function onUsage(event: Event) {
      const detail = (event as CustomEvent<CreditUsage>).detail;
      if (detail && typeof detail.paid === "boolean") {
        applyCreditData(detail);
        return;
      }
      void loadCredits();
    }

    void loadCredits();
    window.addEventListener(USAGE_UPDATED_EVENT, onUsage);
    return () => {
      cancelled = true;
      window.removeEventListener(USAGE_UPDATED_EVENT, onUsage);
    };
  }, [status]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  function openPaywall() {
    window.dispatchEvent(new Event(OPEN_PAYWALL_EVENT));
    setMenuOpen(false);
  }

  function CreditControl({ compact }: { compact: boolean }) {
    if (credits === null) {
      return (
        <div
          className={`h-9 shrink-0 animate-pulse rounded-full bg-blue-50 ${compact ? "w-14" : "w-28"}`}
        />
      );
    }
    return (
      <button
        type="button"
        onClick={openPaywall}
        aria-label={creditLabel}
        title={creditLabel}
        className="inline-flex h-9 max-w-full shrink-0 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
      >
        <span aria-hidden>⚡</span>
        {compact ? (
          <span>{credits.count}</span>
        ) : (
          <span className="truncate whitespace-nowrap">{creditLabel}</span>
        )}
      </button>
    );
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 overflow-x-hidden border-b border-stone-200/80 bg-white/90 backdrop-blur-md md:overflow-visible">
        <div className="flex items-center gap-2 overflow-x-hidden px-3 py-2.5 md:hidden">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-1.5 text-stone-900">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-xs font-semibold text-white">
              CC
            </span>
            <span className="truncate text-sm font-semibold tracking-tight">{t.nav.appName}</span>
          </Link>
          <CreditControl compact />
          <MenuButton
            label={menuOpen ? t.nav.closeMenu : t.nav.openMenu}
            expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          />
        </div>

        <div className="hidden h-16 grid-cols-[1fr_auto_1fr] items-center gap-2 px-6 md:grid">
          <div className="flex items-center justify-self-start">
            <MenuButton
              label={menuOpen ? t.nav.closeMenu : t.nav.openMenu}
              expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            />
          </div>

          <Link
            href="/"
            className="justify-self-center text-center text-base font-semibold tracking-tight text-stone-900"
          >
            <span className="mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 align-middle text-xs text-white">
              CC
            </span>
            <span className="align-middle">{t.nav.appName}</span>
          </Link>

          <div className="flex min-w-0 items-center justify-end gap-3 justify-self-end">
            <LanguageMenu label={t.nav.language} locale={locale} setLocale={setLocale} />
            <CreditControl compact={false} />
            {status === "loading" ? (
              <div className="h-9 w-28 animate-pulse rounded-full bg-stone-100" />
            ) : signedIn ? (
              <div className="flex items-center gap-2">
                <UserAvatar image={session?.user?.image} name={displayName} className="h-8 w-8 text-xs" />
                <span className="hidden max-w-[8rem] truncate text-sm text-stone-600 lg:block">
                  {session?.user?.name || session?.user?.email}
                </span>
                <button
                  type="button"
                  onClick={() => void signOut({ callbackUrl: "/" })}
                  className="rounded-full border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
                >
                  {t.nav.signOut}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void signIn("google", { callbackUrl: "/#upload" })}
                className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
              >
                {t.nav.signIn}
              </button>
            )}
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-[60]">
          <button
            type="button"
            aria-label={t.nav.closeMenu}
            className="absolute inset-0 bg-stone-900/40"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 right-0 flex w-[min(100%,20rem)] flex-col overflow-y-auto bg-white p-5 shadow-xl md:right-auto md:left-0">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold text-stone-900">{t.nav.menu}</p>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-stone-500 hover:bg-stone-100"
              >
                {t.nav.close}
              </button>
            </div>

            <section className="border-b border-stone-100 py-4">
              <p className="mb-3 text-xs font-medium tracking-wide text-stone-400">
                {t.nav.account ?? "Account"}
              </p>
              {status === "loading" ? (
                <div className="h-12 animate-pulse rounded-2xl bg-stone-100" />
              ) : signedIn ? (
                <div className="flex items-center gap-3">
                  <UserAvatar image={session?.user?.image} name={displayName} className="h-10 w-10 shrink-0 text-sm" />
                  <div className="min-w-0 flex-1">
                    {session?.user?.name ? (
                      <p className="truncate text-sm font-medium text-stone-900">{session.user.name}</p>
                    ) : null}
                    {session?.user?.email ? (
                      <p className="truncate text-xs text-stone-500">{session.user.email}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void signOut({ callbackUrl: "/" })}
                    className="shrink-0 rounded-full border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
                  >
                    {t.nav.signOut}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void signIn("google", { callbackUrl: "/#upload" })}
                  className="w-full rounded-full bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
                >
                  {t.nav.signIn}
                </button>
              )}
            </section>

            <section className="border-b border-stone-100 py-4">
              <p className="mb-3 text-xs font-medium tracking-wide text-stone-400">{t.nav.language}</p>
              <LanguageList
                id="language-menu-drawer"
                label={t.nav.language}
                locale={locale}
                setLocale={setLocale}
                onPick={() => setMenuOpen(false)}
              />
            </section>

            <section className="border-b border-stone-100 py-4">
              <p className="text-sm font-medium text-stone-800">
                {credits ? creditLabel : t.nav.topUp ?? "Top up"}
              </p>
              <button
                type="button"
                onClick={openPaywall}
                className="mt-3 w-full rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {t.nav.topUp ?? "Top up"}
              </button>
            </section>

            <nav className="flex flex-col gap-1 py-4">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-3 py-3 font-medium text-stone-800 hover:bg-indigo-50 hover:text-indigo-800"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </aside>
        </div>
      ) : null}
    </>
  );
}
