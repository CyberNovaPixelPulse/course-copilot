import { NextRequest, NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/session";
import { checkoutReturnSession } from "@/lib/checkout-return-links";

export async function GET(request: NextRequest) {
  const session = await getGoogleSession();
  const accountId = session?.user?.id || session?.user?.email;
  if (!accountId)
    return NextResponse.json({ requiresAuth: true }, { status: 401 });
  const attemptId = request.nextUrl.searchParams.get("attempt");
  if (!attemptId || !/^[a-zA-Z0-9-]{1,80}$/.test(attemptId))
    return NextResponse.json(
      { error: "Invalid return reference." },
      { status: 400 },
    );
  try {
    const sessionId = await checkoutReturnSession(attemptId, accountId);
    if (!sessionId)
      return NextResponse.json(
        { error: "Use the payment account." },
        { status: 403 },
      );
    return NextResponse.json(
      { provider: "stripe", paymentId: sessionId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Payment lookup temporarily unavailable." },
      { status: 503 },
    );
  }
}
