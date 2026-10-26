# 課程時段驗收

- `npm run test:course-time`：共用介面的格式、有效性、完整輸出、範圍、衝堂、移動及端點規則。
- `npm run test:checkout`：含待修正內容保存與恢復，以及期限不延長。
- `npm run test:recognition`、`npm run test:recognition-batch`：既有辨識及批次規則回歸，包含後端 ICS 驗證。
- 啟動 `npm run dev -- --hostname 127.0.0.1`，執行 `npm run test:course-time:browser`。第一次需安裝 Playwright Chromium；可用 CHECKOUT_TEST_ORIGIN 指向其他本機埠。
- 瀏覽器回歸：`npm run test:checkout:browser`、`npm run test:entitlement-display:browser`、`npm run test:recognition-batch:browser`。
- 完成 `npx tsc --noEmit`、修改檔案 ESLint、`npm test` 與 `npm run build`。

新瀏覽器流程攔截所有應用 API，不轉送未知請求，使用合成登入、付款前草稿與固定課程。驗證精確新增／編輯、早晚課與週末、拖曳及取消、問題修復與補時段、衝堂、無效輸出阻擋、最後時段刪除確認，並實際產生分享 PNG。ICS 以真實產生器組出回應；後端登入與匯出資格及無效請求由記憶體資料庫路由測試另驗證。

截圖及分享 PNG 輸出到本機暫存目錄供視覺檢查，不加入版本控制。這些是受控工程驗收，未執行真實模型、付款、正式部署或行事曆客戶端匯入；不代表上述外部流程已驗收。

本機驗收結果（2026-10-26）：

- 完整 Node 測試 95 項通過，其中共用時段介面 9 項；型別檢查與正式建置通過。
- 新課程時段瀏覽器流程及既有付款恢復、權益顯示、辨識批次三組瀏覽器回歸皆通過，頁面錯誤為零。
- 新流程包含兩個拖曳邊界、兩個端點、拖曳中固定時間軸、取消、缺失時段補教室、最後時段刪除確認，以及實際分享圖。視覺檢查涵蓋手機、衝堂、00:00／23:59、一分鐘及長課名完整換行。
- 修改檔案 ESLint 通過；全域 ESLint 尚有兩個未修改檔案的既有 set-state-in-effect 錯誤（ExportSuccessModal 與 i18n），不宣稱全域 lint 通過。
- 以 7908ea2 為基準完成獨立 Standards 與 Spec review，修正補時段教室未保存、重複驗證正規化順序及拖曳驗收缺漏後，兩軸複查均無未解決項目。
