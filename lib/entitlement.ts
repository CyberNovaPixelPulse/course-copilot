import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const GPT4O_CAP = 30;
export const FREE_SCAN_CAP = 3;
export const PLAN_PRICE_TWD = 33;
export const COOKIE_NAME = "cc_entitlement";
export const TOKEN_HEADER = "x-cc-token";
export const STORAGE_KEY = "cc_entitlement_token";

export type VisionModel = "gpt-4o" | "gpt-4o-mini";

export type Entitlement = {
  userId: string;
  paid: boolean;
  parseCount: number;
  gpt4oCount: number;
  paidAt?: number;
  freeScansGranted?: boolean;
  freeScansUsed?: number;
  /** Development-only extra credits. Ignored in production. */
  devBonus?: number;
  /** Development-only displayed remaining override. Ignored in production. */
  devRemainingOverride?: number;
};

export type UsagePublic = {
  userId: string;
  paid: boolean;
  parseCount: number;
  gpt4oCount: number;
  gpt4oRemaining: number;
  freeScansRemaining: number;
  canExportIcs: boolean;
  model: VisionModel;
  token: string;
};

function signingSecret() {
  return (
    process.env.USAGE_SECRET ||
    process.env.STRIPE_SECRET_KEY ||
    process.env.OPENAI_API_KEY ||
    "course-copilot-dev-secret"
  );
}

function sign(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function encodeEntitlement(entitlement: Entitlement) {
  const payload = Buffer.from(JSON.stringify(entitlement), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeEntitlement(token: string | undefined | null): Entitlement | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Entitlement;
    if (!parsed?.userId) return null;
    return {
      userId: parsed.userId,
      paid: Boolean(parsed.paid),
      parseCount: Number(parsed.parseCount) || 0,
      gpt4oCount: Number(parsed.gpt4oCount) || 0,
      paidAt: parsed.paidAt,
      freeScansGranted: Boolean(parsed.freeScansGranted),
      freeScansUsed: Number(parsed.freeScansUsed) || 0,
      devBonus: Number(parsed.devBonus) || 0,
      devRemainingOverride:
        typeof parsed.devRemainingOverride === "number" && Number.isFinite(parsed.devRemainingOverride)
          ? parsed.devRemainingOverride
          : undefined,
    };
  } catch {
    return null;
  }
}

export function emptyEntitlement(): Entitlement {
  return {
    userId: randomUUID(),
    paid: false,
    parseCount: 0,
    gpt4oCount: 0,
  };
}

export function selectModel(entitlement: Entitlement, authenticated = false): VisionModel {
  return authenticated && entitlement.paid && entitlement.gpt4oCount < GPT4O_CAP
    ? "gpt-4o"
    : "gpt-4o-mini";
}

export function withFreeScans(entitlement: Entitlement, authenticated: boolean): Entitlement {
  if (!authenticated || entitlement.paid || entitlement.freeScansGranted) return entitlement;
  return {
    ...entitlement,
    freeScansGranted: true,
    freeScansUsed: 0,
  };
}

function devCreditAdjust(base: number, entitlement: Entitlement): number {
  if (process.env.NODE_ENV === "production") return base;
  if (typeof entitlement.devRemainingOverride === "number") {
    return Math.max(0, entitlement.devRemainingOverride);
  }
  return Math.max(0, base + (Number(entitlement.devBonus) || 0));
}

export function freeScansRemaining(entitlement: Entitlement, authenticated: boolean): number {
  if (!authenticated || entitlement.paid) return 0;
  const used = entitlement.freeScansGranted ? entitlement.freeScansUsed ?? 0 : 0;
  return devCreditAdjust(Math.max(0, FREE_SCAN_CAP - used), entitlement);
}

export function consumeFreeScan(entitlement: Entitlement): Entitlement {
  return {
    ...entitlement,
    parseCount: entitlement.parseCount + 1,
    freeScansUsed: (entitlement.freeScansUsed ?? 0) + 1,
  };
}

export function toUsagePublic(entitlement: Entitlement, authenticated = false): UsagePublic {
  return {
    userId: entitlement.userId,
    paid: entitlement.paid,
    parseCount: entitlement.parseCount,
    gpt4oCount: entitlement.gpt4oCount,
    gpt4oRemaining:
      authenticated && entitlement.paid
        ? devCreditAdjust(Math.max(0, GPT4O_CAP - entitlement.gpt4oCount), entitlement)
        : 0,
    freeScansRemaining: freeScansRemaining(entitlement, authenticated),
    canExportIcs: authenticated && entitlement.paid,
    model: selectModel(entitlement, authenticated),
    token: encodeEntitlement(entitlement),
  };
}

export function incrementParse(entitlement: Entitlement, model: VisionModel): Entitlement {
  return {
    ...entitlement,
    parseCount: entitlement.parseCount + 1,
    gpt4oCount: model === "gpt-4o" ? entitlement.gpt4oCount + 1 : entitlement.gpt4oCount,
  };
}

export function markPaid(entitlement: Entitlement): Entitlement {
  return {
    ...entitlement,
    paid: true,
    paidAt: entitlement.paidAt ?? Date.now(),
  };
}

export function withAccountId(entitlement: Entitlement, accountId: string): Entitlement {
  if (entitlement.userId === accountId) return entitlement;
  return { ...entitlement, userId: accountId };
}

export function readEntitlement(request: NextRequest): Entitlement {
  const fromCookie = decodeEntitlement(request.cookies.get(COOKIE_NAME)?.value);
  if (fromCookie) return fromCookie;
  const fromHeader = decodeEntitlement(request.headers.get(TOKEN_HEADER));
  if (fromHeader) return fromHeader;
  return emptyEntitlement();
}

export function attachEntitlement(response: NextResponse, entitlement: Entitlement) {
  const token = encodeEntitlement(entitlement);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
    secure: process.env.NODE_ENV === "production",
  });
  return token;
}

export function usageResponse(
  entitlement: Entitlement,
  extra?: Record<string, unknown>,
  authenticated = false,
) {
  const usage = toUsagePublic(entitlement, authenticated);
  const response = NextResponse.json({ ...usage, ...extra, usage });
  attachEntitlement(response, entitlement);
  return response;
}
