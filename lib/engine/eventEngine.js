export const EVENT_TYPE_RULES = {
  chairman_change: { baseScore: 95, label: "董事長／高階主管異動" },
  trading_halt: { baseScore: 95, label: "停牌／恢復交易" },
  material_announcement: { baseScore: 90, label: "重大訊息" },
  investor_conference: { baseScore: 85, label: "法說會" },
  earnings: { baseScore: 82, label: "財報公布" },
  capital_change: { baseScore: 80, label: "增資／減資／可轉債" },
  monthly_revenue: { baseScore: 70, label: "月營收" },
  target_price_change: { baseScore: 62, label: "目標價／評等調整" },
  unusual_price: { baseScore: 58, label: "異常行情" },
  industry_news: { baseScore: 40, label: "產業新聞" },
  general_news: { baseScore: 20, label: "一般新聞" }
};

export function normalizeEvent(event) {
  const rule = EVENT_TYPE_RULES[event.event_type] || EVENT_TYPE_RULES.general_news;
  const confidence = Math.max(0, Math.min(100, Number(event.confidence ?? 70)));
  const sourceWeight = event.source_type === "official" ? 1 : event.source_type === "reliable_media" ? 0.85 : 0.65;
  const score = Math.round(
    Math.max(0, Math.min(100, Number(event.score ?? rule.baseScore))) *
    (confidence / 100) *
    sourceWeight
  );

  return {
    ...event,
    event_type: event.event_type || "general_news",
    score,
    confidence,
    watch_level:
      score >= 80 ? "red" :
      score >= 50 ? "yellow" :
      "green",
    rule_label: rule.label
  };
}

export function shouldNotify(event, preferences = {}) {
  const normalized = normalizeEvent(event);
  const immediateThreshold = Number(preferences.immediateThreshold ?? 80);
  return normalized.score >= immediateThreshold && !normalized.is_notified;
}

export function buildWatchScore(events = []) {
  if (!events.length) return 0;
  const top = [...events]
    .map(normalizeEvent)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const weighted = top.reduce((sum, item, index) => {
    const weight = index === 0 ? 1 : index === 1 ? 0.45 : 0.2;
    return sum + item.score * weight;
  }, 0);

  return Math.min(100, Math.round(weighted));
}
