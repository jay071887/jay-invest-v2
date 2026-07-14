import { normalizeEvent } from "./eventEngine";
import { evaluateStrategyImpact } from "./strategyEngine";

export function buildDecisionSummary(events = [], strategies = {}) {
  const normalized = events.map(normalizeEvent);
  const impactful = normalized.filter((event) =>
    evaluateStrategyImpact(event, strategies).impactsStrategy
  );
  const high = normalized.filter((event) => event.score >= 80);
  const medium = normalized.filter((event) => event.score >= 50 && event.score < 80);

  if (impactful.length > 0 || high.length > 0) {
    return {
      status: "red",
      title: "今天有事件值得重新評估",
      minutes: 10,
      reason: `共有 ${Math.max(impactful.length, high.length)} 件高重要性事件。`
    };
  }

  if (medium.length > 0) {
    return {
      status: "yellow",
      title: "今天有事件值得關注",
      minutes: 3,
      reason: `共有 ${medium.length} 件中等重要性事件。`
    };
  }

  return {
    status: "green",
    title: "今天不用操作",
    minutes: 0,
    reason: "目前沒有事件足以改變你的原定投資策略。"
  };
}
