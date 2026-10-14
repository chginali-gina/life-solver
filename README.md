# 生活觀察解題室

鳳新高中自主學習工具：引導學生從生活觀察中找出問題，選擇初階到進階的實作方案，並記錄執行過程與成果。

- 學生網頁：`/`
- 老師後台：`/teacher`（密碼登入；看全班每個步驟的回答、寫建議、設關卡、回覆週報、管理名單、匯出 CSV）

## 架構（全部在 Vercel）

- `index.html`：學生網頁，完成步驟時自動同步到 `/api/student`
- `api/student.js`：學生端 API（建立身分、同步、送出、老師建議、週報）
- `api/teacher.js`：老師端 API（需 `TEACHER_PASSWORD`）
- `teacher.html`：老師後台
- 資料存在 Vercel Blob（private），只有網站程式讀得到

## 需要的設定（Vercel 專案 → Settings → Environment Variables）

| 名稱 | 說明 |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | 建立 Blob store（Private）並連到專案後自動產生 |
| `TEACHER_PASSWORD` | 老師後台密碼 |
| `CLASS_CODE` | 選填，學生的班級代碼，預設 `fengxin2026` |
| `GOOGLE_CLIENT_ID` | 選填，填了才需要學校帳號驗證（前端 `index.html` 也要填同一個值） |

鳳新高中英文科李姬慧老師 X AI 彙整製作
