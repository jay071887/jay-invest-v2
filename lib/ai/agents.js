export const AGENT_CONTRACTS = {
  market: {
    input: ["market_data", "macro_events"],
    output: ["market_summary", "risk_flags"]
  },
  company: {
    input: ["official_announcements", "financial_data"],
    output: ["company_events", "evidence_chain"]
  },
  news: {
    input: ["news_items", "portfolio_symbols"],
    output: ["relevant_news", "source_quality"]
  },
  portfolio: {
    input: ["holdings", "cash", "strategies"],
    output: ["allocation", "portfolio_risks"]
  },
  decision: {
    input: ["events", "strategies", "portfolio"],
    output: ["daily_decision", "attention_minutes"]
  },
  notification: {
    input: ["events", "notification_preferences"],
    output: ["notification_queue"]
  }
};
