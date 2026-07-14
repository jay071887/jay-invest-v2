# Jay Invest V5 Alpha 2.1 — Portfolio Intelligence

## 本版修正
- 完全移除寫死的 `8027`、`1409`
- 模擬器只讀取：
  - 目前庫存中存在的股票代號
  - 股數大於 0 的持股
- 已賣出的股票不會再被追蹤或建立事件
- 持股不足時，以市場事件補足，不會加入陌生股票
- 模擬事件依目前月份產生：
  - 財報季
  - 法說觀察
  - 月營收觀察
- 黃金事件只有在「黃金持續買進」開啟時才建立
- 正2事件只有在「正2加碼策略」開啟時才建立
- 長期模式降低短線異動權重
- 波段與短線模式才額外建立量價異動事件

## 更新方式
1. GitHub Desktop 確認分支是 `v5-ai-engine`
2. 解壓縮 ZIP
3. 覆蓋本機 `jay-invest-v2`
4. Summary：
   `Jay Invest V5 Alpha 2.1 Portfolio Intelligence`
5. Commit to v5-ai-engine
6. Push origin
7. 開啟 Vercel Preview 測試

## 測試前
先在事件中心按「清除模擬事件」，把先前含 8027、1409 的舊模擬資料刪除。

## 測試方式
1. 確認持股管理裡只剩目前真正持有的股票
2. 按「模擬我的投資組合」
3. 檢查 Watch Score 與事件中心
4. 不應再出現未持有的 8027 或 1409

本版不需要新增 Supabase SQL。
