# OFFCUT Gmail Relay（獨立設定）

1. 使用 `offcut.studio.2026@gmail.com` 開啟 [Google Apps Script](https://script.google.com/) 並建立新專案。
2. 將本資料夾的 `GmailRelay.gs` 全文貼入 `Code.gs`。
3. 在「專案設定 → 指令碼屬性」新增 `RELAY_SECRET`，填入一段新的高熵隨機密鑰。不要使用服飾官網的值，也不要貼到網站或聊天。
4. 選取 `authorizeMail` 執行一次，依 Google 畫面授權寄信。
5. 「部署 → 新增部署 → 網頁應用程式」；執行身分選「我」，存取權選「所有人」。Relay 只在驗證 Worker secret 後接受訊息，且收件人固定為 OFFCUT Gmail。
6. 複製以 `/exec` 結尾的 Web App URL。這個 URL 可公開；`RELAY_SECRET` 不可公開。
7. 將程式部署完成後的 URL 提供給 Codex，填入 Cloudflare Worker Secret `GMAIL_RELAY_URL`。不要提供或傳送 `RELAY_SECRET`。

Google Apps Script 僅寄信與保存 48 小時寄信去重鍵；不保存訂單或客戶資料。Worker 使用同一通知 key 重試時，Relay 會回報已寄送而不重複寄信。
