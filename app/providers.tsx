"use client";

import { SessionProvider } from "next-auth/react";
import { EntitlementDisplayProvider } from "./components/EntitlementDisplay";
import { LanguageProvider } from "@/lib/i18n";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LanguageProvider>
        <EntitlementDisplayProvider>{children}</EntitlementDisplayProvider>
      </LanguageProvider>
    </SessionProvider>
  );
}
