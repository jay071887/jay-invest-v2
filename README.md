# Jay Invest v3.4 Trade Ledger

## 本版新增
- 可自行設定證券手續費折數，例如 2 折填 2
- 可自行設定每筆最低手續費
- 買進前即時計算：
  - 成交金額
  - 折扣後手續費
  - 交割總成本
  - 含手續費單位成本
- 按「加入庫存並更新均價」後：
  - 相同股票自動增加股數
  - 依舊成本＋本次總成本自動重算平均成本
  - 新股票自動建立庫存
  - 自動新增買進紀錄
- 買進紀錄與券商設定會透過 Supabase 在手機、電腦同步

## 計算方式
買進成交金額 = 股數 × 成交價格

手續費 = max（最低手續費，成交金額 × 0.1425% × 折扣比例）

新平均成本 =
（原股數 × 原平均成本 ＋ 本次成交金額 ＋ 本次手續費）
÷ 新總股數

## 更新方式
1. 解壓縮 ZIP。
2. 複製所有內容到 GitHub Desktop 的 jay-invest-v2 本機資料夾。
3. 選擇取代目的地中的檔案。
4. GitHub Desktop：
   - Summary：Upgrade to Jay Invest v3.4 Trade Ledger
   - Commit to main
   - Push origin
5. 等待 Vercel 自動部署。
