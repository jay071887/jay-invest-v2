# Jay Invest v3.3 Strategy

## 本版完成
- 新增「策略中心」，所有主要策略可勾選開關
- 009816 定期定額：預設開啟
- 大盤 -10% / -20% / -30% 回檔提醒：預設開啟
- 正2加碼策略：預設關閉
- 黃金持續買進：預設關閉
- 緊急預備金管理：預設開啟
- 投資日誌模組：預設開啟
- 正2關閉時，大盤仍可提醒，但不會顯示成正2買進指令
- 黃金關閉時，仍追蹤目前持有市值，但策略摘要顯示「維持持有、不新增」
- Email 註冊確認連結明確使用目前正式網站網址，不再導向 localhost
- 所有開關狀態存入 Supabase，手機與電腦同步

## 更新方式
1. 解壓縮 ZIP。
2. 複製所有內容到 GitHub Desktop 的 jay-invest-v2 本機資料夾。
3. 選擇取代目的地中的檔案。
4. GitHub Desktop：
   - Summary：Upgrade to Jay Invest v3.3 Strategy
   - Commit to main
   - Push origin
5. 等待 Vercel 自動部署。
