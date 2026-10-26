# 帳號權益快照驗收

## 執行方式

- `npm run test:entitlement-display`：module 對外 interface 的確定性行為測試。
- `npx playwright install chromium`：首次安裝驗收瀏覽器。
- 一個終端執行 `npm run dev -- --hostname 127.0.0.1`，另一個執行 `npm run test:entitlement-display:browser`。可用 `CHECKOUT_TEST_ORIGIN` 指定其他本機埠。
- `npm run test:checkout:browser`：既有付款恢復瀏覽器回歸。
- `npx tsc --noEmit`、`npm test`、`npm run build` 及修改檔案的 ESLint。

## 驗收證據範圍

module 測試控制讀取、回應先後、故障與通知；檢查共享查詢、操作立即更新、舊查詢／故障晚回、重疊操作收斂、變動後補查、401、舊登入失效、異常資料與舊契約轉換。

瀏覽器攔截所有應用 API，以合成帳號及課表，實際操作付款返回、辨識、優惠碼、多分頁、前景刷新及重試。數字與狀態同時檢查導覽列及上傳區；失敗保留數字不代表刷新已成功。另確認課表及編輯對話框不被背景更新關閉、同頁切換帳號後舊回應隔離、未知權益下載不引導付款，以及匯出 401 在登入導向前清除快照。

未處理的請求回傳測試錯誤，不放行真實付款或模型。此驗收不代表正式金流、正式資料庫或跨裝置即時同步通過。沒有後端 revision 時，不承諾不同裝置間可證明的全域新舊排序。
