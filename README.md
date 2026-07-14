# Jay Invest V5 Alpha 2.3 — Decision First

## 本版重點
首頁最上方現在會先回答：

> 今天需要變動嗎？

可能顯示：

- 綠色：今天不需要變動，維持原策略
- 黃色：有事件值得關注，但目前不用調整
- 紅色：有高重要事件，建議重新檢視

## AI 今日決策區塊
會顯示：

- 今天是否需要變動
- 建議閱讀時間
- AI 今日信心
- 直接影響持股事件數
- 高重要事件數
- 判斷理由
- 目前投資策略摘要
- 最值得先看的三件事件
- 最後更新時間
- 重新分析按鈕

## 信心分數說明
目前 Alpha 版本的信心分數依照：

- 官方來源數量
- 可信媒體來源數量
- 直接影響持股事件數
- 是否存在來源衝突

進行規則式計算。

這不是未來漲跌機率，也不是保證正確的買賣訊號。

## 更新方式
1. GitHub Desktop 確認分支是 `v5-ai-engine`
2. 解壓縮 ZIP
3. 覆蓋本機 `jay-invest-v2`
4. Summary：
   `Jay Invest V5 Alpha 2.3 Decision First`
5. Commit to v5-ai-engine
6. Push origin
7. 開啟 Vercel Preview 測試

本版不需要新增 Supabase SQL。
