# Jay Invest V6 — Wealth Assistant Foundation

## 本版重點

V6 第一版先建立穩定可部署的「財富助理」基礎，並修復先前定期定額殘留造成的 Vercel Build Error。

### 修復
- 完整修復 `app/page.js` JSX 語法錯誤
- 移除定期定額殘留文字
- 移除黃金策略殘留文字
- 策略摘要只保留正2平衡策略
- 市場分析與模擬器維持移除

### V6 財富目標
新增可自訂：
- 財富目標金額
- 目標日期
- 每月預計投入

系統自動計算：
- 目前完成率
- 距離目標金額
- 剩餘月份
- 每月約需投入金額
- 目前進度是否正常

### 保留功能
- Jay AI：今天需要變動？
- Jay AI 規則式問答
- Cash Engine
- 可投資現金
- 緊急預備金
- 股票庫存與均價
- 事件中心
- AI 績效分析
- 正2平衡策略（開啟後才顯示比例設定）

## 更新方式
1. GitHub Desktop 確認分支為 `v5-ai-engine`
2. 解壓縮 ZIP
3. 覆蓋本機 `jay-invest-v2`
4. Summary：`Jay Invest V6 Wealth Assistant Foundation`
5. Commit
6. Push origin
7. 開啟 Vercel Preview

本版不需要新增 Supabase SQL。
