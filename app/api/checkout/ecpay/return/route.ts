// Browser redirects are never trusted as proof of payment. Only ReturnURL grants access.
export async function POST(request: Request) {
  const body = await request.formData();
  const tradeNo = body.get("MerchantTradeNo");
  const origin = new URL(process.env.NEXTAUTH_URL || request.url).origin;
  const url = new URL("/", origin);
  if (typeof tradeNo === "string" && /^[a-z0-9]{1,20}$/i.test(tradeNo)) url.searchParams.set("ecpay_order", tradeNo);
  return Response.redirect(url, 303);
}
