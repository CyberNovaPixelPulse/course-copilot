# 行事曆匯出驗收

- `npm run test:calendar-export`：跨匯出協調介面驗證固定快照、一次準備／使用者明確交付、回應檢查、三十秒上限、重試、失效與獨立圖片狀態。以受控 HTTP、時間、交付與繪圖替身測試可觀察行為。
- 啟動 `npm run dev -- --hostname 127.0.0.1`，另執行 `npm run test:calendar-export:browser`。首次需安裝 Playwright Chromium，可用 CHECKOUT_TEST_ORIGIN 指定本機埠。
- 瀏覽器攔截所有應用 API，未知路徑不轉送。驗證實際下載事件及檔案文字、固定快照與實際圖片文字、連點、替換、帳號切換、超時、無效回應、交付失敗、重開、同檔重新下載，以及模擬 iOS 呈現與明確替代操作。
- `npm run test:course-time:browser`、`npm run test:recognition-batch:browser`、`npm run test:checkout:browser`、`npm run test:entitlement-display:browser` 為既有流程回歸。課程時段修復後依新契約明確選擇改用目前課表重新匯出。
- 路由測試保留 JSON、GET、表單輸出及登入／資格驗證；共用介面內容回歸固定時間檢查日期、時間、每週十六次與事件識別。
- 完成型別檢查、修改檔案 ESLint、完整 Node 測試及正式建置；畫面截圖在本機暫存目錄供視覺驗證，不提交圖片。

Apple 專用交付尚未完成真實 iPhone／iPad 與日曆匯入驗收。裝置偵測、模擬瀏覽器與 adapter 測試只證明工程流程；data URI 觸發不能證明已保存或匯入。需另行驗證真機，未完成前介面明示此限制並保留一般 ICS 下載。

本輪不執行真實模型、付款或部署；不保證日曆客戶端會為重複匯入去重。

本機驗收結果（2026-10-26）：

- 完整 Node 測試 106 項通過，其中匯出協調介面 11 項；型別檢查、正式建置與修改檔案 ESLint 通過。
- 新匯出瀏覽器流程與既有課程時段、辨識批次、付款恢復、權益顯示四組回歸皆通過，頁面錯誤為零。
- 新流程驗證真實下載事件與相同檔案內容、圖片快照文字、圖片失敗重試、無效回應、交付故障、帳號切換、登出、三十秒上限、pagehide／pageshow 失效與重新開始，以及模擬 iOS 入口及明確替代下載。桌面及手機截圖已視覺檢查。
- 全域 ESLint 尚有未修改的 i18n 元件一項既有 set-state-in-effect 錯誤；不宣稱全域 lint 通過。原結果視窗的同類錯誤已隨本次生命週期重整消除。
- 以 a5cfb7c 為基準完成獨立 Standards 與 Spec review；補齊待處理匯出的登出、離頁／返回瀏覽器驗收後，兩軸複查均無未解決項目。
- 真實 iPhone／iPad 日曆匯入仍未驗收；未執行真實模型、付款或部署。
