import { NextRequest } from "next/server";
import { incrementParse, readEntitlement, usageResponse, withAccountId } from "@/lib/entitlement";
import { getGoogleSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getGoogleSession();
  const googleId = session?.user?.id || session?.user?.email;
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);
  return usageResponse(entitlement, { signedIn: Boolean(session) }, Boolean(session));
}

export async function POST(request: NextRequest) {
  const session = await getGoogleSession();
  const googleId = session?.user?.id || session?.user?.email;
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);
  let body: { increment?: boolean; model?: "gpt-4o" | "gpt-4o-mini" } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  if (body.increment) {
    entitlement = incrementParse(entitlement, body.model === "gpt-4o" ? "gpt-4o" : "gpt-4o-mini");
  }
  return usageResponse(entitlement, { signedIn: Boolean(session) }, Boolean(session));
}
