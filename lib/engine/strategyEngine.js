export function evaluateStrategyImpact(event, strategies = {}) {
  const symbol = String(event.symbol || "").trim();
  const type = event.event_type || "";

  if (type === "gold" && !strategies.goldBuying) {
    return {
      impactsStrategy: false,
      message: "黃金新增策略目前關閉，僅保留資訊追蹤。"
    };
  }

  if ((type === "leveraged_etf" || symbol === "00685L") && !strategies.leveragedEtf) {
    return {
      impactsStrategy: false,
      message: "正2策略目前關閉，不產生買進提醒。"
    };
  }

  if (type === "market_drawdown" && strategies.marketDrawdownReminder) {
    return {
      impactsStrategy: true,
      message: "已符合你設定的大盤回檔觀察條件。"
    };
  }

  if (Number(event.score || 0) >= 80) {
    return {
      impactsStrategy: true,
      message: "高重要性事件，建議重新檢視原本投資假設。"
    };
  }

  return {
    impactsStrategy: false,
    message: "目前沒有足夠資訊需要改變原定策略。"
  };
}
