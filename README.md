# Jay Invest v3.2 Cloud

## 本版完成
- Supabase Email/密碼登入
- Google 登入按鈕（需在 Supabase 啟用 Google Provider）
- 手機、電腦、平板雲端同步
- v3.1 LocalStorage 資料首次登入自動搬到雲端
- 持股、現金、預備金、黃金、大盤高點、資產快照全部同步
- 投資現金與緊急預備金重新命名，避免混淆
- Supabase RLS：每個帳號只能讀寫自己的資料
- 原有股票、大盤、黃金、加碼提醒功能保留

## 更新方法
1. 解壓縮本 ZIP。
2. 將內容覆蓋到 GitHub Desktop 的 jay-invest-v2 本機資料夾。
3. GitHub Desktop：
   - Summary：Upgrade to Jay Invest v3.2 Cloud
   - Commit to main
   - Push origin
4. Vercel 自動部署。

## 第一次使用
1. 網站打開後點「第一次使用？建立帳號」。
2. 使用 Email + 至少 6 碼密碼註冊。
3. 若 Supabase Email Confirmation 開啟，請到信箱點確認。
4. 手機與電腦使用同一組 Email / 密碼登入。
5. 第一次登入會自動尋找此裝置的 v3.1 資料並搬到雲端。

## Google 登入
Google 按鈕已寫入，但 Supabase 尚需設定 Google OAuth：
Authentication → Providers → Google。
在設定完成前，Email 登入可立即使用。

## 安全
- 專案只使用 Publishable Key。
- 不包含 Secret Key 或 service_role key。
- user_data 已開啟 RLS，每位使用者只能存取自己的資料。
