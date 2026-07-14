# Jay Invest V5 Roadmap

## Alpha 1 — Foundation
- [x] 建立 v5-ai-engine 分支
- [x] Event Engine 資料模型
- [x] Event Score
- [x] Watch Score
- [x] Strategy Impact
- [x] Decision Summary
- [x] Event Center UI
- [x] 手動測試事件
- [x] AI Agent contracts
- [x] Notification Queue 資料表

## Alpha 2.1 — Portfolio Intelligence
- [x] 移除寫死的 8027、1409
- [x] 只讀取實際持有且股數大於 0 的庫存
- [x] 持股不足時改用市場層級事件補足
- [x] 依月份產生財報／法說／月營收事件
- [x] 黃金與正2事件依策略開關決定是否建立
- [x] 長期／波段／短線模式
- [x] 自動更新 Watch Score
- [x] 自動更新今日決策
- [x] 清除模擬事件
- [x] 完整事件分析卡
- [x] 事件重要性標示
- [x] 資料可信度標示
- [x] 對投資組合影響
- [x] 建議閱讀時間
- [x] AI 摘要與建議
- [x] 來源類型與原始連結
- [x] AI 評分原因展開
- [x] 首頁最上方先回答「今天是否需要變動」
- [x] AI 今日信心
- [x] 判斷理由
- [x] 直接影響持股件數
- [x] 高重要事件件數
- [x] 最值得先看的三件事
- [x] 目前策略摘要

## Alpha 3 — Data Connectors
- [ ] MOPS 重大訊息
- [ ] 月營收與財報
- [ ] 盤中異常行情
- [ ] 新聞來源分級
- [ ] 事件去重

## Alpha 4 — Morning Brief
- [ ] 每日盤前摘要
- [ ] 今日需要花幾分鐘
- [ ] 證據鏈
- [ ] AI 解釋
- [ ] AI 報告

## Alpha 5 — Notifications
- [ ] PWA
- [ ] Web Push
- [ ] 盤中事件排程
- [ ] 重複通知抑制
- [ ] 使用者通知偏好

## Alpha 2.4 — Custom recurring strategy
- [x] 定期定額標的可自行修改
- [x] 每次投入金額可自行修改
- [x] 扣款日期可自行修改
- [x] 策略備註可自行修改
- [x] 首頁與策略摘要同步顯示自訂標的
- [x] 每月投入總額自動計算

## Alpha 3.3 — Cash Engine
- [x] 買進自動扣除現金
- [x] 賣出自動加回現金
- [x] 現金收入與支出
- [x] 自動更新庫存
- [x] 自動重算均價
- [x] 自動計算已實現損益
- [x] 可投資現金
- [x] 交易前現金預估
- [x] 完整現金流水
- [x] 一鍵復原交易
- [x] 股票資金使用率
- [x] 勝率與已實現績效
- [x] AI 資金提醒

## Alpha 3.4 — Compact Event Center
- [x] 事件中心預設縮小顯示
- [x] 桌面版同時顯示約 3 則
- [x] 平板版同時顯示約 2 則
- [x] 手機版顯示 1 則並露出下一則
- [x] 支援滑鼠滾輪／觸控左右滑動
- [x] 預設卡片只顯示重點摘要
- [x] 「查看全部」展開完整事件卡
- [x] 「收合」回到精簡滑動模式

## Alpha 3.5 — Conditional Rebalance
- [x] AI 決策首頁簡化為「今天需要變動？」
- [x] 正2策略關閉時不顯示調節資訊
- [x] 正2策略開啟時顯示目前股票／可投資現金比例
- [x] 可設定股票與現金目標比例
- [x] 可設定容忍區間
- [x] 自動估算需要調節的金額
- [x] 緊急預備金不納入平衡計算
- [x] 黃金不納入平衡計算
