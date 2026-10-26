import { accountStore } from "@/lib/account-access";
import { getTurso } from "@/lib/turso";
import { acceptPaymentNotification } from "@/lib/ecpay-orders";

export async function POST(request: Request) {
  try {
    const body = await request.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of body) {
      if (typeof value !== "string" || key in params)
        return new Response("0|Invalid parameters", { status: 400 });
      params[key] = value;
    }
    const accepted = await acceptPaymentNotification(params);
    if (accepted && params.RtnCode === "1" && params.SimulatePaid === "0") {
      const order = (
        await getTurso().execute({
          sql: "SELECT account_id FROM cc_ecpay_orders WHERE trade_no=?",
          args: [params.MerchantTradeNo],
        })
      ).rows[0];
      if (order) await accountStore().importEcpay(String(order.account_id));
    }
    return new Response(accepted ? "1|OK" : "0|Invalid notification", {
      status: accepted ? 200 : 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("0|Unable to process notification", { status: 503 });
  }
}
