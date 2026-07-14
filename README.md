# Jay Invest V5 Alpha 3.5 — Conditional Rebalance

## 本版邏輯
首頁最上方只保留：

> 今天需要變動？

### 正2平衡策略關閉
只顯示：
- 不需要
- 建議重新檢視

不顯示任何正2調節比例或金額。

### 正2平衡策略開啟
首頁會另外顯示：
- 股票目標比例
- 可投資現金目標比例
- 目前股票比例
- 目前可投資現金比例
- 容忍區間
- 是否需要平衡
- 建議增加或減少股票的估算金額

## 預設策略
- 股票：60%
- 可投資現金：40%
- 容忍區間：±5%

以上都可在策略中心自行修改。

## 重要資金規則
正2平衡只計算：

`股票市值 + 可投資現金`

完全不計算：
- 緊急預備金
- 黃金

因此系統不會建議把生活預備金或黃金拿來加碼。

## 更新方式
1. GitHub Desktop 確認分支是 `v5-ai-engine`
2. 解壓縮 ZIP
3. 覆蓋本機 `jay-invest-v2`
4. Summary：
   `Jay Invest V5 Alpha 3.5 Conditional Rebalance`
5. Commit to v5-ai-engine
6. Push origin
7. 開啟 Vercel Preview 測試

本版不需要新增 Supabase SQL。
