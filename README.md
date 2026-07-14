# Jay Invest V5 Alpha 1

這是 V5 的第一個基礎版本，重點是建立 Event Engine，而不是直接接 AI。

## 已完成
- Event Engine
- Event Score
- Watch Score
- Strategy Impact
- Decision Summary
- 事件中心 UI
- 手動建立測試事件
- 標記事件已讀
- AI Agent 輸入輸出介面
- AI Reports 資料表
- Notification Queue 資料表
- ROADMAP.md

## 第一步：執行 Supabase SQL
在 Supabase：

1. SQL Editor
2. New query
3. 開啟本專案：
   `supabase/migrations/v5_alpha1.sql`
4. 複製全部 SQL
5. 貼上並按 Run
6. 成功時應顯示 Success

## 第二步：更新 v5-ai-engine 分支
1. 確認 GitHub Desktop Current branch 是 `v5-ai-engine`
2. 解壓縮 ZIP
3. 覆蓋本機 jay-invest-v2 專案
4. Summary：
   `Jay Invest V5 Alpha 1`
5. Commit to v5-ai-engine
6. Push origin

## Vercel 測試
目前 main 仍是正式版。要測試 V5：

- GitHub Push 後，Vercel 通常會建立 Preview Deployment
- 在 Vercel Deployments 找到 branch `v5-ai-engine`
- 打開 Preview 網址測試

不要先合併到 main。確認 V5 Alpha 1 正常後再處理。
