# Jay Invest V6 — Simple Decision & Holdings Fix

## 本版修改

### 首頁決策
只顯示：
- 今天需要變動？
- 需要／不需要

若正2平衡策略開啟，才額外顯示：
- 需要調整／不用調整
- 建議調整金額

已移除：
- 詢問 Jay AI
- 為什麼
- 事件中心

### 新增交易按鈕
買進、賣出、現金收入、現金支出按鈕已放大，較容易點選。

### 持股不再消失
修正原本的重大問題：

以前新增買進交易時，系統會只依交易紀錄重建庫存，造成原先手動輸入的持股股數消失。

現在改成：
- 買進既有股票：原始股數＋本次股數
- 平均成本依原始庫存與本次成交重新計算
- 買進新股票：新增一筆持股
- 賣出：只扣除賣出股數
- 其他未交易持股完全保留
- 復原交易會回復交易前的原始股數與均價

## 更新方式
1. GitHub Desktop 確認分支為 `v5-ai-engine`
2. 解壓縮 ZIP
3. 覆蓋本機 `jay-invest-v2`
4. Summary：`Jay Invest V6 Simple Decision Holdings Fix`
5. Commit
6. Push origin
7. 開啟 Vercel Preview

本版不需要新增 Supabase SQL。


## V6.0.3 財富目標修正

修正「目前總資產顯示 $0、完成率 NaN%」問題。

原因是財富目標區讀取了不存在的 `computed.totalAssets`，但資產引擎實際欄位名稱是 `computed.totalAsset`。

修正後會帶入：
- 股票市值
- 黃金市值
- 可投資現金
- 緊急預備金

並正常計算完成率、距離目標與每月所需投入。
