/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness transpiles project TypeScript. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { createClient } = require('@libsql/client');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(specifier, ...args) {
  return originalResolve.call(this, specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier, ...args);
};
Module._extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
};
const db = createClient({ url: ':memory:' });
const turso = require('../lib/turso.ts');
turso.getTurso = () => db;
process.env.ECPAY_MERCHANT_ID = 'test-merchant';
process.env.ECPAY_HASH_KEY = 'test-key';
process.env.ECPAY_HASH_IV = 'test-iv';
const ecpay = require('../lib/ecpay.ts');
const orders = require('../lib/ecpay-orders.ts');
const ent = require('../lib/entitlement.ts');
const webhook = require('../app/api/webhooks/ecpay/route.ts');
const returned = require('../app/api/checkout/ecpay/return/route.ts');
function notification(tradeNo, extra = {}) {
  const params = { MerchantID: 'test-merchant', MerchantTradeNo: tradeNo, TradeNo: 'gateway-'+tradeNo, TradeAmt: '9', RtnCode: '1', SimulatePaid: '0', ...extra };
  params.CheckMacValue = ecpay.checkMacValue(params, 'test-key', 'test-iv');
  return params;
}
function unpaid(id) { return {...ent.emptyEntitlement(), userId:id}; }
before(async () => { await orders.ensurePaymentTables(); });
after(() => db.close());
test('unique alphanumeric trade numbers fit ECPay limit', () => {
  const ids = Array.from({length:1000}, () => ecpay.merchantTradeNo());
  assert.equal(new Set(ids).size, ids.length);
  assert(ids.every(id => /^[A-Za-z0-9]{20}$/.test(id)));
  assert.equal(ecpay.merchantTradeDate(new Date('2026-10-15T16:01:02Z')), '2026/10/16 00:01:02');
});
test('official CheckMacValue fixture', () => {
  const params = { TradeDesc:'促銷方案', PaymentType:'aio', MerchantTradeDate:'2023/03/12 15:30:23', MerchantTradeNo:'ecpay20230312153023', MerchantID:'3002607', ReturnURL:'https://www.ecpay.com.tw/receive.php', ItemName:'Apple iphone 15', TotalAmount:'30000', ChoosePayment:'ALL', EncryptType:'1' };
  assert.equal(ecpay.checkMacValue(params, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs'), '6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840');
});
test('reject unknown order, tampered signature, amount and merchant', async () => {
  await orders.createPaymentOrder('invalidcases', unpaid('invalid-user'), 'test-merchant', ecpay.ECPAY_PRODUCTION_URL);
  assert.equal(await orders.acceptPaymentNotification(notification('missing')), false);
  assert.equal(await orders.acceptPaymentNotification({...notification('invalidcases'), TradeAmt:'1'}), false);
  assert.equal(await orders.acceptPaymentNotification(notification('invalidcases', {TradeAmt:'10'})), false);
  assert.equal(await orders.acceptPaymentNotification(notification('invalidcases', {MerchantID:'other'})), false);
  assert.equal(await orders.acceptPaymentNotification({...notification('invalidcases'), CheckMacValue:'wrong'}), false);
});
test('failed and simulated payments do not unlock', async () => {
  await orders.createPaymentOrder('simulation', unpaid('sim-user'), 'test-merchant', ecpay.ECPAY_PRODUCTION_URL);
  assert.equal(await orders.acceptPaymentNotification(notification('simulation', {SimulatePaid:'1'})), true);
  assert.equal(await orders.acceptPaymentNotification(notification('simulation', {RtnCode:'0'})), true);
  assert.equal((await orders.reconcileEcpayEntitlement(unpaid('sim-user'))).paid, false);
});
test('real payment grants 30 once; retries, repeated purchase, restore and consumption', async () => {
  await orders.createPaymentOrder('purchase1', unpaid('buyer'), 'test-merchant', ecpay.ECPAY_PRODUCTION_URL);
  const callback = notification('purchase1');
  assert.equal(await orders.acceptPaymentNotification(callback), true);
  assert.equal(await orders.acceptPaymentNotification(callback), true);
  let state = await orders.reconcileEcpayEntitlement(unpaid('buyer'));
  assert.equal(ent.toUsagePublic(state,true).gpt4oRemaining,30);
  state = await orders.reconcileEcpayEntitlement(state);
  assert.equal(ent.toUsagePublic(state,true).gpt4oRemaining,30);
  state = await orders.recordEcpayUsage(ent.incrementParse(state,'gpt-4o'));
  assert.equal(ent.toUsagePublic(state,true).gpt4oRemaining,29);
  const restored = await orders.reconcileEcpayEntitlement(unpaid('buyer'));
  assert.equal(ent.toUsagePublic(restored,true).gpt4oRemaining,29);
  await orders.createPaymentOrder('purchase2', state, 'test-merchant', ecpay.ECPAY_PRODUCTION_URL);
  await orders.acceptPaymentNotification(notification('purchase2'));
  state = await orders.reconcileEcpayEntitlement(state);
  assert.equal(ent.toUsagePublic(state,true).gpt4oRemaining,59);
  assert.equal(ent.toUsagePublic(await orders.reconcileEcpayEntitlement(unpaid('buyer')),true).gpt4oRemaining,59);
  assert.equal(ent.withAccountId(state,'someone-else').paid,false);
});
test('existing coupon allowance is preserved when purchasing', async () => {
  const coupon = ent.grantCreditCoupon(unpaid('coupon-buyer'), 'PROMO', 10);
  await orders.createPaymentOrder('couponpurchase', coupon, 'test-merchant', ecpay.ECPAY_PRODUCTION_URL);
  await orders.acceptPaymentNotification(notification('couponpurchase'));
  const state = await orders.reconcileEcpayEntitlement(coupon);
  assert.equal(ent.toUsagePublic(state,true).gpt4oRemaining,40);
});
test('webhook returns exact acknowledgement and browser redirect grants nothing', async () => {
  await orders.createPaymentOrder('webhooktest', unpaid('webhook-user'), 'test-merchant', ecpay.ECPAY_PRODUCTION_URL);
  const response = await webhook.POST(new Request('https://example.com/api/webhooks/ecpay', {method:'POST',body:new URLSearchParams(notification('webhooktest'))}));
  assert.equal(response.status,200);
  assert.equal(await response.text(),'1|OK');
  const bad = await webhook.POST(new Request('https://example.com/api/webhooks/ecpay', {method:'POST',body:new URLSearchParams({MerchantTradeNo:'missing'})}));
  assert.equal(bad.status,400);
  const redirect = await returned.POST(new Request('https://example.com/api/checkout/ecpay/return', {method:'POST',body:new URLSearchParams({MerchantTradeNo:'unpaid',RtnCode:'1'})}));
  assert.equal(redirect.status,303);
  assert.equal(new URL(redirect.headers.get('location')).searchParams.get('ecpay_order'),'unpaid');
});
