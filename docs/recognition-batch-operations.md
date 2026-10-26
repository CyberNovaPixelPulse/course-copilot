# 辨識批次驗收

- `npm run test:recognition-batch`：跨 module interface，以固定回應、儲存及時間驗證逐張狀態、候選結果、重試範圍、等待及接續規則。
- `npx playwright install chromium`：首次安裝瀏覽器。
- 啟動 `npm run dev -- --hostname 127.0.0.1`，另執行 `npm run test:recognition-batch:browser`；可用 `CHECKOUT_TEST_ORIGIN` 指向其他本機埠。
- 既有回歸：`npm run test:entitlement-display:browser`、`npm run test:checkout:browser`。
- `npx tsc --noEmit`、`npm test`、`npm run build` 與修改檔案的 ESLint。

瀏覽器使用合成圖片與登入，攔截辨識及帳號回應，驗證部分成功、暫停、指定重試、繼續、明確載入與覆寫拒絕、原工作查詢、新選圖阻擋、壓縮故障與略過、儲存故障與重試、晚到結果不覆寫、權益同步，以及重整重選後接續／最近辨識取回。不執行真實模型或付款。

單張工作成功與扣次依後端保存判定；結束批次、關頁或超時不等於取消、未扣次或退款。圖片與整批候選不持久保存；重整後未送出圖片需重選，已成功單張結果依既有七天政策從最近辨識取回。本機固定回應不代表實際圖片品質或正式環境驗收。
