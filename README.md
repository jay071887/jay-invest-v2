# Jay Invest V5 AI Assistant — Core v1

## 新增功能

### Jay AI Assistant
首頁最上方直接回答：

> 今天需要變動？

狀態包括：
- 不需要
- 建議關注
- 需要調節
- 建議重新檢視

### 一句話摘要
直接說明今日結論，不再顯示大量統計。

### 為什麼？
按下後才展開：
- 實際持股數量
- 今日持股事件數
- 最高重要事件
- 正2策略狀態
- 可投資現金

### 正2條件顯示
只有正2平衡策略開啟時，首頁才會顯示：
- 目前股票／可投資現金比例
- 目標比例
- 建議調節金額

關閉時完全隱藏。

### Jay AI 問答
目前內建規則式問答，可詢問：
- 今天需要變動嗎？
- 今天適合加碼嗎？
- 可投資現金多少？
- 哪一檔最重要？
- 今天有利空嗎？
- 正2是否需要平衡？

回答只根據目前登入使用者自己的：
- 持股
- 可投資現金
- 策略
- 事件中心

## 重要說明
這是 AI Assistant Core v1，目前使用透明的規則引擎，不會把資料傳給外部 AI，也不需要 API Key。

下一階段才會串接：
- 官方持股事件資料
- AI 摘要 API
- 晨報排程
- 盤中推播

## 更新方式
1. GitHub Desktop 確認分支是 `v5-ai-engine`
2. 解壓縮 ZIP
3. 覆蓋本機 `jay-invest-v2`
4. Summary：
   `Jay Invest V5 AI Assistant Core`
5. Commit to v5-ai-engine
6. Push origin
7. 開啟 Vercel Preview 測試

本版不需要新增 Supabase SQL。
