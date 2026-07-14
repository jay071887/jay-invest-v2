# Jay Invest V5 Alpha 2

## 新增功能
- AI 市場模擬器
- 一鍵建立 5 件模擬市場事件
- 優先使用目前庫存股票代號
- 長期／波段／短線三種策略模式
- 不同模式會調整一般新聞與盤中異動的重要分數
- 模擬後自動更新：
  - Event Center
  - Watch Score
  - 今日決策
  - 建議閱讀分鐘數
- 一鍵清除所有模擬事件
- 手動新增事件改放在「進階」區域

## 更新方式
1. GitHub Desktop 確認目前分支為 `v5-ai-engine`
2. 解壓縮 ZIP
3. 把所有內容覆蓋到本機 `jay-invest-v2`
4. Summary：
   `Jay Invest V5 Alpha 2`
5. Commit to v5-ai-engine
6. Push origin
7. 到 Vercel 開啟 v5-ai-engine Preview 測試

## 測試方式
1. 登入 Preview 網站
2. 找到「AI 市場模擬器」
3. 選擇長期、波段或短線模式
4. 按「模擬今天市場」
5. 檢查：
   - 今日決策有沒有改變
   - Watch Score 是否產生
   - 事件中心是否出現事件
6. 測試完按「清除模擬事件」

本版不需要新增 Supabase SQL。
