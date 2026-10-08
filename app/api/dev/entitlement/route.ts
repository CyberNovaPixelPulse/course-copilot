import { NextRequest, NextResponse } from "next/server";
import {
  GPT4O_CAP,
  markPaid,
  readEntitlement,
  usageResponse,
  withAccountId,
  withFreeScans,
} from "@/lib/entitlement";
import { getGoogleSession } from "@/lib/session";

type DevAction = "paid" | "unpaid" | "add" | "zero";

function isAction(value: unknown): value is DevAction {
  return value === "paid" || value === "unpaid" || value === "add" || value === "zero";
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let action: unknown;
  try {
    const body = (await request.json()) as { action?: unknown };
    action = body.action;
  } catch {
    action = null;
  }
  if (!isAction(action)) {
    return NextResponse.json({ error: "Unknown dev action." }, { status: 400 });
  }

  const session = await getGoogleSession();
  const googleId = session?.user?.id || session?.user?.email;
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);

  if (action === "paid") {
    entitlement = {
      ...markPaid(entitlement),
      gpt4oCount: 0,
      devBonus: 0,
      devRemainingOverride: undefined,
    };
  } else if (action === "unpaid") {
    entitlement = withFreeScans(
      {
        ...entitlement,
        paid: false,
        paidAt: undefined,
        unlockMethod: undefined,
        devBonus: 0,
        devRemainingOverride: undefined,
      },
      Boolean(session),
    );
  } else if (action === "add") {
    if (typeof entitlement.devRemainingOverride === "number") {
      entitlement = {
        ...entitlement,
        devRemainingOverride: entitlement.devRemainingOverride + 10,
      };
    } else {
      entitlement = { ...entitlement, devBonus: (entitlement.devBonus ?? 0) + 10 };
    }
  } else {
    entitlement = { ...entitlement, devBonus: 0, devRemainingOverride: 0, gpt4oCount: entitlement.paid ? GPT4O_CAP : entitlement.gpt4oCount };
  }

  return usageResponse(entitlement, {}, Boolean(session));
}
