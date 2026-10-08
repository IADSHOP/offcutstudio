# OFFCUT 訂單 Worker（獨立設定）

此服務使用 OFFCUT 專屬 Cloudflare Worker + SQLite Durable Object；訂單不放 Google Sheet。部署前需先完成 [Gmail Relay 設定](../google-apps-script/SETUP.md)。

## 部署

1. 在 Cloudflare 建立/登入 OFFCUT 自己的帳號或 Worker 專案；不要使用或覆寫 IAD SHOP 服飾站 Worker。
2. 在本資料夾執行 `npx wrangler login`，確認登入 OFFCUT 要使用的 Cloudflare 帳號。
3. 加入三個 Worker Secret（輸入時不要把 secret 放進命令列參數、程式碼或 Git）：
   - `GMAIL_RELAY_URL`：OFFCUT Gmail Relay 的 `/exec` URL。
   - `RELAY_SECRET`：和 OFFCUT Apps Script `RELAY_SECRET` 完全相同的值。不能與服飾站共用。
   - `ADMIN_SECRET`：另一組獨立高熵密鑰，供店家人工更新訂單狀態及重試通知。
4. 執行 `npx wrangler deploy --config server/wrangler.toml`。Worker 名稱、 Durable Object namespace 及設定均為 OFFCUT 專屬。
5. 部署完成後將 `/orders` API URL（例如 `https://offcut-studio-orders.<account>.workers.dev/orders`）填入 `site-config.js` 的 `OFFCUT_ORDER_API_URL`，再發布網站。

`ALLOWED_ORIGINS` 已列出 OFFCUT GitHub Pages 網域與本機預覽來源。不要加入服飾站來源。`SEND_BUYER_CONFIRMATION` 預設為 `false`；本階段不寄買家確認信。

## 人工訂單操作

管理 API 使用 `/admin` + `Authorization: Bearer <ADMIN_SECRET>`。`adminStatus` 可更新 `paymentStatus`、`materialStatus`、`productionStatus`；`adminEmails` 檢視通知佇列狀態；`adminRetryEmail` 可重試失敗通知。不可將管理密鑰放在網站前端。

付款回報接受後，狀態是 `PAYMENT REVIEW`，不會自動設成已付款。Relay 暫時失敗只會留在 Worker outbox 重試；客戶仍可進素材頁。Buyer confirmation 關閉。
