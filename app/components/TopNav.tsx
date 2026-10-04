"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { useI18n, type Locale } from "@/lib/i18n";

export default function TopNav() {
  const { data: session, status } = useSession();
  const { t, locale, setLocale } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = status === "authenticated";

  const navLinks = [
    { href: "/", label: t.nav.home },
    { href: "/#upload", label: t.nav.upload },
    { href: "/#how-it-works", label: t.nav.howItWorks },
  ];

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

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-stone-200/80 bg-white/90 backdrop-blur-md">
        <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 sm:px-6">
          <div className="flex items-center justify-self-start">
            <button
              type="button"
              aria-label={t.nav.openMenu}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-stone-800 hover:bg-stone-100"
            >
              ☰
            </button>
          </div>

          <Link
            href="/"
            className="justify-self-center text-center text-sm font-semibold tracking-tight text-stone-900 sm:text-base"
          >
            <span className="mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 align-middle text-xs text-white">
              CC
            </span>
            <span className="align-middle">{t.nav.appName}</span>
          </Link>

          <div className="flex items-center justify-end gap-2 justify-self-end sm:gap-3">
            <label className="sr-only" htmlFor="language-switcher">
              {t.nav.language}
            </label>
            <select
              id="language-switcher"
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
              className="h-9 max-w-[7.5rem] rounded-full border border-stone-200 bg-white px-2 text-xs text-stone-700 sm:max-w-none sm:px-3 sm:text-sm"
            >
              <option value="zh-TW">{t.nav.langZh}</option>
              <option value="en">{t.nav.langEn}</option>
            </select>

            {status === "loading" ? (
              <div className="h-9 w-24 animate-pulse rounded-full bg-stone-100 sm:w-28" />
            ) : signedIn ? (
              <div className="flex items-center gap-2">
                {session?.user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.user.image}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover ring-1 ring-stone-200"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                    {(session?.user?.name || session?.user?.email || "U")
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                )}
                <span className="hidden max-w-[8rem] truncate text-sm text-stone-600 lg:block">
                  {session?.user?.name || session?.user?.email}
                </span>
                <button
                  type="button"
                  onClick={() => void signOut({ callbackUrl: "/" })}
                  className="rounded-full border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 sm:px-3 sm:text-sm"
                >
                  {t.nav.signOut}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void signIn("google", { callbackUrl: "/#upload" })}
                className="rounded-full bg-stone-900 px-2.5 py-2 text-xs font-medium text-white hover:bg-stone-800 sm:px-4 sm:text-sm"
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
          <aside className="absolute inset-y-0 left-0 flex w-[min(100%,20rem)] flex-col bg-white p-5 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <p className="font-semibold text-stone-900">{t.nav.menu}</p>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-stone-500 hover:bg-stone-100"
              >
                {t.nav.close}
              </button>
            </div>
            <nav className="flex flex-col gap-1">
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
