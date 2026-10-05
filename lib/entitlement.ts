import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const GPT4O_CAP = 30;
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
};

export type UsagePublic = {
  userId: string;
  paid: boolean;
  parseCount: number;
  gpt4oCount: number;
  gpt4oRemaining: number;
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

export function toUsagePublic(entitlement: Entitlement, authenticated = false): UsagePublic {
  return {
    userId: entitlement.userId,
    paid: entitlement.paid,
    parseCount: entitlement.parseCount,
    gpt4oCount: entitlement.gpt4oCount,
    gpt4oRemaining:
      authenticated && entitlement.paid ? Math.max(0, GPT4O_CAP - entitlement.gpt4oCount) : 0,
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
