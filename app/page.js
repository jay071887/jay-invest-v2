"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  buildWatchScore,
  normalizeEvent
} from "../lib/engine/eventEngine";
import { buildDecisionSummary } from "../lib/engine/decisionEngine";
import { evaluateStrategyImpact } from "../lib/engine/strategyEngine";

const DEFAULT_DATA = {
  holdings: [
    {
      id: "default-009816",
      symbol: "009816",
      shares: 0,
      averageCost: 0
    }
  ],
  settings: {
    investmentCash: 150000,
    emergencyFund: 250000,
    goldTael: 2.1,
    manualGoldTaelPrice: 0,
    taiexHigh: 0,
    goal: 3000000,
    brokerageDiscount: 2,
    minimumFee: 20
  },
  snapshots: [],
  transactions: [],
  executedTier: "",
  strategies: {
    recurring009816: true,
    marketDrawdownReminder: true,
    leveragedEtf: false,
    goldBuying: false,
    emergencyFund: true,
    investmentJournal: true
  }
};

const money = (value) =>
  new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

const signedMoney = (value) => {
  const n = Number(value) || 0;
  return `${n > 0 ? "+" : ""}${money(n)}`;
};

function cloneDefaultData() {
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("尚未登入");
  const [data, setData] = useState(cloneDefaultData());
  const [market, setMarket] = useState({ stocks: [], taiex: {} });
  const [gold, setGold] = useState(null);
  const [goldBase, setGoldBase] = useState(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventMessage, setEventMessage] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [strategyMode, setStrategyMode] = useState("long_term");
  const [newEvent, setNewEvent] = useState({
    symbol: "",
    event_type: "material_announcement",
    title: "",
    summary: "",
    source_name: "手動建立",
    source_type: "official",
    score: 90,
    confidence: 100
  });
  const [trade, setTrade] = useState({
    symbol: "009816",
    shares: 0,
    price: 0,
    date: new Date().toISOString().slice(0, 10)
  });
  const [tradeMessage, setTradeMessage] = useState("");
  const saveTimer = useRef(null);
  const hydrated = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: authData }) => {
      setSession(authData.session);
      setAuthLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      hydrated.current = false;
      return;
    }

    loadCloudData(session.user.id);
    loadEvents(session.user.id);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !hydrated.current) return;

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveCloudData(session.user.id, data);
    }, 700);

    return () => clearTimeout(saveTimer.current);
  }, [data, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !data.holdings.length) return;

    refreshMarketData();
    const timer = setInterval(refreshMarketData, 5 * 60 * 1000);

    return () => clearInterval(timer);
  }, [
    session?.user?.id,
    data.holdings.map((holding) => holding.symbol).join(",")
  ]);

  async function loadCloudData(userId) {
    setCloudLoading(true);
    setCloudStatus("正在下載雲端資料…");

    const { data: row, error } = await supabase
      .from("user_data")
      .select("data")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      setCloudStatus(`雲端讀取失敗：${error.message}`);
      setCloudLoading(false);
      return;
    }

    if (row?.data) {
      setData({
        ...cloneDefaultData(),
        ...row.data,
        settings: {
          ...cloneDefaultData().settings,
          ...(row.data.settings || {})
        },
        strategies: {
          ...cloneDefaultData().strategies,
          ...(row.data.strategies || {})
        },
        transactions: Array.isArray(row.data.transactions)
          ? row.data.transactions
          : []
      });
      setCloudStatus("已從雲端同步");
    } else {
      const migrated = migrateLocalV31();
      const initialData = migrated || cloneDefaultData();

      setData(initialData);

      const { error: insertError } = await supabase
        .from("user_data")
        .upsert(
          {
            user_id: userId,
            data: initialData,
            updated_at: new Date().toISOString()
          },
          { onConflict: "user_id" }
        );

      setCloudStatus(
        insertError
          ? `首次雲端建立失敗：${insertError.message}`
          : migrated
          ? "已將此裝置 v3.1 資料搬到雲端"
          : "已建立新的雲端資料"
      );
    }

    hydrated.current = true;
    setCloudLoading(false);
  }

  function migrateLocalV31() {
    try {
      const holdings = localStorage.getItem("jay31-holdings");
      const settings = localStorage.getItem("jay31-settings");
      const snapshots = localStorage.getItem("jay31-snapshots");
      const executedTier = localStorage.getItem("jay31-executed-tier");

      if (!holdings && !settings && !snapshots) return null;

      return {
        holdings: holdings
          ? JSON.parse(holdings)
          : cloneDefaultData().holdings,
        settings: settings
          ? {
              ...cloneDefaultData().settings,
              ...JSON.parse(settings)
            }
          : cloneDefaultData().settings,
        snapshots: snapshots ? JSON.parse(snapshots) : [],
        executedTier: executedTier || "",
        strategies: cloneDefaultData().strategies,
        transactions: []
      };
    } catch {
      return null;
    }
  }

  async function saveCloudData(userId, nextData) {
    setCloudStatus("正在儲存…");

    const { error } = await supabase
      .from("user_data")
      .upsert(
        {
          user_id: userId,
          data: nextData,
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      );

    setCloudStatus(
      error
        ? `雲端儲存失敗：${error.message}`
        : `已同步 ${new Date().toLocaleTimeString("zh-TW", {
            hour: "2-digit",
            minute: "2-digit"
          })}`
    );
  }


  async function loadEvents(userId) {
    setEventsLoading(true);

    const { data: rows, error } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .order("event_time", { ascending: false })
      .limit(100);

    if (error) {
      setEventMessage(
        error.message.includes("events")
          ? "事件資料表尚未建立，請先執行 ZIP 內的 supabase/migrations/v5_alpha1.sql。"
          : `事件讀取失敗：${error.message}`
      );
      setEvents([]);
    } else {
      setEvents((rows || []).map(normalizeEvent));
      setEventMessage("");
    }

    setEventsLoading(false);
  }


  async function simulateTodayMarket() {
    if (!session?.user?.id) return;

    setSimulating(true);
    setEventMessage("正在依照你的投資組合建立模擬事件…");

    const holdings = (data.holdings || [])
      .map((holding) => ({
        symbol: String(holding.symbol || "").trim(),
        shares: Number(holding.shares) || 0,
        averageCost: Number(holding.averageCost) || 0
      }))
      .filter((holding) => holding.symbol && holding.shares > 0);

    const now = new Date();
    const month = now.getMonth() + 1;
    const nowIso = now.toISOString();

    const portfolioValueBySymbol = holdings.map((holding) => {
      const quote = (market.stocks || []).find(
        (item) => item.symbol === holding.symbol
      );
      const price = Number(quote?.price) || holding.averageCost || 0;

      return {
        ...holding,
        estimatedValue: holding.shares * price
      };
    });

    const sortedHoldings = [...portfolioValueBySymbol].sort(
      (a, b) => b.estimatedValue - a.estimatedValue
    );

    const activeStrategies = {
      ...cloneDefaultData().strategies,
      ...(data.strategies || {})
    };

    const portfolioEvents = sortedHoldings.flatMap(
      (holding, index) => {
        const importanceBoost = Math.max(0, 8 - index * 2);
        const events = [];

        if ([1, 4, 7, 10].includes(month)) {
          events.push({
            symbol: holding.symbol,
            event_type: "earnings",
            title: `${holding.symbol} 財報季觀察`,
            summary:
              "目前屬於財報季，建議關注獲利、毛利率、現金流與公司展望是否改變原本投資假設。",
            source_name: "V5 模擬器",
            source_type: "official",
            score: 80 + importanceBoost,
            confidence: 100,
            event_time: nowIso
          });
        } else if ([2, 5, 8, 11].includes(month)) {
          events.push({
            symbol: holding.symbol,
            event_type: "investor_conference",
            title: `${holding.symbol} 法說與展望觀察`,
            summary:
              "本月常見法說與季報後續說明，重點在訂單、資本支出與未來展望。",
            source_name: "V5 模擬器",
            source_type: "official",
            score: 84 + importanceBoost,
            confidence: 100,
            event_time: nowIso
          });
        } else {
          events.push({
            symbol: holding.symbol,
            event_type: "monthly_revenue",
            title: `${holding.symbol} 月營收觀察`,
            summary:
              "月營收屬於中高重要事件，需搭配年增率、月增率及市場預期判讀。",
            source_name: "V5 模擬器",
            source_type: "official",
            score: 70 + importanceBoost,
            confidence: 100,
            event_time: nowIso
          });
        }

        if (strategyMode !== "long_term") {
          events.push({
            symbol: holding.symbol,
            event_type: "unusual_price",
            title: `${holding.symbol} 盤中成交量異動`,
            summary:
              strategyMode === "short_term"
                ? "短線模式提高盤中量價異動權重，建議確認是否有正式公告或籌碼變化。"
                : "波段模式同時觀察成交量、均線與事件催化。",
            source_name: "V5 模擬器",
            source_type: "unknown",
            score: strategyMode === "short_term" ? 76 : 58,
            confidence: 65,
            event_time: nowIso
          });
        }

        return events;
      }
    );

    const marketEvents = [
      {
        symbol: null,
        event_type: "material_announcement",
        title: "重要總經事件觀察",
        summary:
          "國際市場有重要總經數據或央行訊息，可能提高市場波動，但目前仍需依你的既定策略判斷是否行動。",
        source_name: "V5 模擬器",
        source_type: "official",
        score: 86,
        confidence: 95,
        event_time: nowIso
      },
      {
        symbol: null,
        event_type: "industry_news",
        title: "台股整體市場風險觀察",
        summary:
          "本事件用於補足持股不足時的市場層級資訊，不會加入任何你未持有的股票代號。",
        source_name: "V5 模擬器",
        source_type: "reliable_media",
        score: strategyMode === "short_term" ? 60 : 42,
        confidence: 78,
        event_time: nowIso
      }
    ];

    if (activeStrategies.goldBuying) {
      marketEvents.push({
        symbol: "GOLD",
        event_type: "gold",
        title: "黃金策略觀察",
        summary:
          "黃金買進策略已開啟，因此保留價格與風險事件提醒。",
        source_name: "V5 模擬器",
        source_type: "official",
        score: 55,
        confidence: 90,
        event_time: nowIso
      });
    }

    if (activeStrategies.leveragedEtf) {
      marketEvents.push({
        symbol: "00685L",
        event_type: "leveraged_etf",
        title: "正2策略觀察",
        summary:
          "正2策略已開啟，模擬器才會建立相關事件；關閉時不會出現。",
        source_name: "V5 模擬器",
        source_type: "official",
        score: 68,
        confidence: 90,
        event_time: nowIso
      });
    }

    const rawEvents = [
      ...portfolioEvents,
      ...marketEvents
    ].slice(0, Math.max(5, holdings.length * 2 + 2));

    const rows = rawEvents.map((event) => {
      const impact = evaluateStrategyImpact(
        event,
        activeStrategies
      );

      return {
        ...event,
        user_id: session.user.id,
        strategy_impact: impact.impactsStrategy
      };
    });

    const { error } = await supabase
      .from("events")
      .insert(rows);

    if (error) {
      setEventMessage(`模擬失敗：${error.message}`);
      setSimulating(false);
      return;
    }

    setEventMessage(
      holdings.length > 0
        ? `已依照 ${holdings.length} 檔實際持股建立 ${rows.length} 件模擬事件，不會再補入未持有股票。`
        : `目前沒有有效庫存，已建立 ${rows.length} 件市場層級模擬事件。`
    );

    await loadEvents(session.user.id);
    setSimulating(false);
  }

  async function clearSimulatorEvents() {
    if (!session?.user?.id) return;

    const { error } = await supabase
      .from("events")
      .delete()
      .eq("user_id", session.user.id)
      .eq("source_name", "V5 模擬器");

    if (error) {
      setEventMessage(`清除失敗：${error.message}`);
      return;
    }

    setEventMessage("模擬事件已清除。");
    await loadEvents(session.user.id);
  }

  async function addManualEvent() {
    if (!session?.user?.id) return;

    if (!newEvent.title.trim()) {
      setEventMessage("請先輸入事件標題。");
      return;
    }

    const impact = evaluateStrategyImpact(
      newEvent,
      data.strategies || {}
    );

    const payload = {
      user_id: session.user.id,
      symbol: newEvent.symbol.trim() || null,
      event_type: newEvent.event_type,
      title: newEvent.title.trim(),
      summary: newEvent.summary.trim() || null,
      source_name: newEvent.source_name || "手動建立",
      source_type: newEvent.source_type,
      score: Number(newEvent.score) || 20,
      confidence: Number(newEvent.confidence) || 70,
      strategy_impact: impact.impactsStrategy,
      event_time: new Date().toISOString()
    };

    const { error } = await supabase
      .from("events")
      .insert(payload);

    if (error) {
      setEventMessage(`新增事件失敗：${error.message}`);
      return;
    }

    setNewEvent({
      ...newEvent,
      symbol: "",
      title: "",
      summary: ""
    });
    setEventMessage("事件已加入 V5 Event Engine。");
    await loadEvents(session.user.id);
  }

  async function markEventRead(eventId) {
    const { error } = await supabase
      .from("events")
      .update({ is_read: true })
      .eq("id", eventId);

    if (!error) {
      setEvents((current) =>
        current.map((event) =>
          event.id === eventId
            ? { ...event, is_read: true }
            : event
        )
      );
    }
  }

  async function refreshMarketData() {
    setMarketLoading(true);

    const symbols = data.holdings
      .map((holding) => holding.symbol.trim())
      .filter(Boolean)
      .join(",");

    const [marketResult, goldResult] = await Promise.allSettled([
      fetch(`/api/market?symbols=${encodeURIComponent(symbols)}`, {
        cache: "no-store"
      }).then((response) => response.json()),
      fetch("/api/gold", { cache: "no-store" }).then((response) =>
        response.json()
      )
    ]);

    if (marketResult.status === "fulfilled" && marketResult.value.ok) {
      setMarket(marketResult.value);

      const currentIndex = marketResult.value.taiex?.price || 0;
      if (currentIndex) {
        setData((current) => ({
          ...current,
          settings: {
            ...current.settings,
            taiexHigh: Math.max(
              Number(current.settings.taiexHigh) || 0,
              currentIndex
            )
          }
        }));
      }
    }

    if (goldResult.status === "fulfilled" && goldResult.value.ok) {
      setGold(goldResult.value);
      updateGoldBase(goldResult.value.taelBuy);
    } else {
      setGold(null);
    }

    setMarketLoading(false);
  }

  function updateGoldBase(price) {
    const today = new Date().toISOString().slice(0, 10);
    const saved = localStorage.getItem("jay32-gold-base");
    const base = saved ? JSON.parse(saved) : null;

    let next;
    if (!base) {
      next = { date: today, current: price, previous: price };
    } else if (base.date !== today) {
      next = { date: today, current: price, previous: base.current };
    } else {
      next = { ...base, current: price };
    }

    localStorage.setItem("jay32-gold-base", JSON.stringify(next));
    setGoldBase(next);
  }

  const computed = useMemo(() => {
    const quoteMap = Object.fromEntries(
      (market.stocks || []).map((quote) => [quote.symbol, quote])
    );

    const holdings = data.holdings.map((holding) => {
      const quote = quoteMap[holding.symbol] || {};
      const price = quote.price || 0;
      const previousClose = quote.previousClose || price;

      const marketValue = Number(holding.shares) * price;
      const dailyPnl =
        Number(holding.shares) * (price - previousClose);
      const totalPnl =
        Number(holding.shares) *
        (price - Number(holding.averageCost));

      return {
        ...holding,
        name: quote.name || holding.symbol,
        price,
        marketValue,
        dailyPnl,
        totalPnl,
        returnPct:
          holding.averageCost > 0
            ? ((price / Number(holding.averageCost)) - 1) * 100
            : 0
      };
    });

    const stockValue = holdings.reduce(
      (sum, holding) => sum + holding.marketValue,
      0
    );
    const stockDaily = holdings.reduce(
      (sum, holding) => sum + holding.dailyPnl,
      0
    );
    const stockTotal = holdings.reduce(
      (sum, holding) => sum + holding.totalPnl,
      0
    );

    const automaticGoldPrice = gold?.taelBuy || 0;
    const goldTaelPrice =
      automaticGoldPrice ||
      Number(data.settings.manualGoldTaelPrice) ||
      0;
    const goldPrevious = goldBase?.previous || goldTaelPrice;
    const goldValue =
      Number(data.settings.goldTael) * goldTaelPrice;
    const goldDaily =
      Number(data.settings.goldTael) *
      (goldTaelPrice - goldPrevious);

    const totalAsset =
      Number(data.settings.investmentCash) +
      Number(data.settings.emergencyFund) +
      stockValue +
      goldValue;

    const taiex = market.taiex?.price || 0;
    const high = Number(data.settings.taiexHigh) || taiex;
    const drawdown =
      high > 0 && taiex > 0 ? ((taiex / high) - 1) * 100 : 0;

    return {
      holdings,
      stockValue,
      stockDaily,
      stockTotal,
      goldTaelPrice,
      goldValue,
      goldDaily,
      totalAsset,
      dailyTotal: stockDaily + goldDaily,
      drawdown
    };
  }, [data, market, gold, goldBase]);

  useEffect(() => {
    if (!hydrated.current || !computed.totalAsset) return;

    const today = new Date().toISOString().slice(0, 10);

    setData((current) => {
      const existing = current.snapshots || [];
      const previousToday = existing.find((item) => item.date === today);

      if (
        previousToday &&
        Math.round(previousToday.total) ===
          Math.round(computed.totalAsset)
      ) {
        return current;
      }

      return {
        ...current,
        snapshots: [
          ...existing.filter((item) => item.date !== today),
          {
            date: today,
            total: computed.totalAsset,
            stocks: computed.stockValue,
            gold: computed.goldValue,
            investmentCash: Number(
              current.settings.investmentCash
            ),
            emergencyFund: Number(
              current.settings.emergencyFund
            )
          }
        ].slice(-365)
      };
    });
  }, [computed.totalAsset]);


  const tradePreview = useMemo(() => {
    const shares = Number(trade.shares) || 0;
    const price = Number(trade.price) || 0;
    const amount = shares * price;
    const discount = Math.max(
      0,
      Number(data.settings.brokerageDiscount) || 0
    ) / 10;
    const calculatedFee = amount * 0.001425 * discount;
    const fee =
      amount > 0
        ? Math.max(
            Number(data.settings.minimumFee) || 0,
            Math.round(calculatedFee)
          )
        : 0;
    const totalCost = amount + fee;

    return {
      amount,
      fee,
      totalCost,
      effectiveUnitCost: shares > 0 ? totalCost / shares : 0
    };
  }, [
    trade,
    data.settings.brokerageDiscount,
    data.settings.minimumFee
  ]);

  function addBuyTransaction() {
    const symbol = trade.symbol.trim();
    const shares = Math.floor(Number(trade.shares) || 0);
    const price = Number(trade.price) || 0;

    if (!symbol || shares <= 0 || price <= 0) {
      setTradeMessage("請輸入股票代號、買進股數與成交價格。");
      return;
    }

    const existingIndex = data.holdings.findIndex(
      (holding) => holding.symbol === symbol
    );
    const nextHoldings = [...data.holdings];

    if (existingIndex >= 0) {
      const existing = nextHoldings[existingIndex];
      const oldShares = Number(existing.shares) || 0;
      const oldCostBasis =
        oldShares * (Number(existing.averageCost) || 0);
      const newShares = oldShares + shares;
      const newAverageCost =
        (oldCostBasis + tradePreview.totalCost) / newShares;

      nextHoldings[existingIndex] = {
        ...existing,
        shares: newShares,
        averageCost: Number(newAverageCost.toFixed(6))
      };
    } else {
      nextHoldings.push({
        id: crypto.randomUUID(),
        symbol,
        shares,
        averageCost: Number(
          tradePreview.effectiveUnitCost.toFixed(6)
        )
      });
    }

    const transaction = {
      id: crypto.randomUUID(),
      type: "buy",
      symbol,
      shares,
      price,
      amount: tradePreview.amount,
      fee: tradePreview.fee,
      totalCost: tradePreview.totalCost,
      date: trade.date,
      createdAt: new Date().toISOString()
    };

    setData({
      ...data,
      holdings: nextHoldings,
      transactions: [
        transaction,
        ...(data.transactions || [])
      ].slice(0, 500)
    });

    setTradeMessage(
      `已買進 ${symbol} ${shares.toLocaleString(
        "zh-TW"
      )} 股，庫存與均價已自動更新。`
    );

    setTrade({
      ...trade,
      shares: 0,
      price: 0
    });
  }

  function deleteTransaction(transactionId) {
    setData({
      ...data,
      transactions: (data.transactions || []).filter(
        (transaction) => transaction.id !== transactionId
      )
    });
  }

  const strategy = {
    ...cloneDefaultData().strategies,
    ...(data.strategies || {})
  };

  const drawdownEnabled = strategy.marketDrawdownReminder;
  const leveragedEnabled = strategy.leveragedEtf;

  const advice =
    !drawdownEnabled
      ? {
          tier: "",
          title: "大盤回檔提醒已關閉",
          amount: 0,
          tone: "blue"
        }
      : computed.drawdown <= -30
      ? {
          tier: "-30%",
          title: leveragedEnabled ? "正2 第三次加碼" : "大盤第三次加碼提醒",
          amount: 150000,
          tone: "red"
        }
      : computed.drawdown <= -20
      ? {
          tier: "-20%",
          title: leveragedEnabled ? "正2 第二次加碼" : "大盤第二次加碼提醒",
          amount: 100000,
          tone: "orange"
        }
      : computed.drawdown <= -10
      ? {
          tier: "-10%",
          title: leveragedEnabled ? "正2 第一次加碼" : "大盤第一次加碼提醒",
          amount: 50000,
          tone: "green"
        }
      : {
          tier: "",
          title: "今天不用額外操作",
          amount: 0,
          tone: "blue"
        };


  const strategyForDecision = {
    ...cloneDefaultData().strategies,
    ...(data.strategies || {})
  };

  const decisionSummary = buildDecisionSummary(
    events,
    strategyForDecision
  );

  const eventsBySymbol = useMemo(() => {
    return events.reduce((map, event) => {
      const key = event.symbol || "MARKET";
      if (!map[key]) map[key] = [];
      map[key].push(event);
      return map;
    }, {});
  }, [events]);

  const watchScores = Object.entries(eventsBySymbol)
    .map(([symbol, symbolEvents]) => ({
      symbol,
      score: buildWatchScore(symbolEvents),
      count: symbolEvents.length
    }))
    .sort((a, b) => b.score - a.score);

  if (authLoading) {
    return (
      <main className="center">
        <div className="card">正在檢查登入狀態…</div>
      </main>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>Jay Invest</h1>
          <p>V5 Alpha 2.1・Portfolio Intelligence</p>
        </div>
        <div className="topActions">
          <button
            className="refresh"
            onClick={refreshMarketData}
            disabled={marketLoading}
          >
            {marketLoading ? "更新中" : "更新行情"}
          </button>
          <button
            className="ghostButton"
            onClick={() => supabase.auth.signOut()}
          >
            登出
          </button>
        </div>
      </header>

      <div className="syncBar">
        <span>{session.user.email}</span>
        <b>{cloudLoading ? "同步中…" : cloudStatus}</b>
      </div>

      <section className={`card commandCenter ${decisionSummary.status}`}>
        <div className="commandTop">
          <div>
            <span>V5 今日決策</span>
            <h2>{decisionSummary.title}</h2>
            <p>{decisionSummary.reason}</p>
          </div>
          <div className="minutesBox">
            <strong>{decisionSummary.minutes}</strong>
            <small>分鐘</small>
          </div>
        </div>
        <div className="commandMeta">
          <span>事件數：{events.length}</span>
          <span>
            未讀：{events.filter((event) => !event.is_read).length}
          </span>
          <button
            className="textButton"
            onClick={() => loadEvents(session.user.id)}
            disabled={eventsLoading}
          >
            {eventsLoading ? "更新中" : "更新事件"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <h2>Watch Score</h2>
            <small>分數代表今天值不值得花時間關注，不是買賣評分。</small>
          </div>
          <span className="modeBadge">V5</span>
        </div>

        {watchScores.length === 0 ? (
          <div className="empty smallEmpty">
            尚無事件。可先在下方手動建立一筆測試事件。
          </div>
        ) : (
          <div className="watchList">
            {watchScores.slice(0, 8).map((item) => (
              <div className="watchItem" key={item.symbol}>
                <div>
                  <b>{item.symbol}</b>
                  <small>{item.count} 件事件</small>
                </div>
                <span
                  className={
                    item.score >= 80
                      ? "score redScore"
                      : item.score >= 50
                      ? "score yellowScore"
                      : "score greenScore"
                  }
                >
                  {item.score}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <h2>事件中心</h2>
            <small>V5 的晨報、推播、研究報告都會共用這裡的資料。</small>
          </div>
        </div>

        {eventMessage && (
          <div className="tradeMessage">{eventMessage}</div>
        )}

        {events.length === 0 ? (
          <div className="empty smallEmpty">
            目前沒有事件。
          </div>
        ) : (
          <div className="eventList">
            {events.slice(0, 20).map((event) => (
              <article
                className={`eventItem ${event.watch_level} ${
                  event.is_read ? "read" : ""
                }`}
                key={event.id}
              >
                <div className="eventScore">
                  <strong>{event.score}</strong>
                  <small>{event.confidence}%</small>
                </div>
                <div className="eventContent">
                  <div className="eventTitle">
                    <b>{event.symbol || "市場"}</b>
                    <span>{event.rule_label}</span>
                  </div>
                  <h3>{event.title}</h3>
                  {event.summary && <p>{event.summary}</p>}
                  <small>
                    {event.source_name || "未知來源"}・
                    {new Date(event.event_time).toLocaleString("zh-TW")}
                  </small>
                  {!event.is_read && (
                    <button
                      className="textButton"
                      onClick={() => markEventRead(event.id)}
                    >
                      標記已讀
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card simulatorCard">
        <div className="sectionHeader">
          <div>
            <h2>AI 市場模擬器</h2>
            <small>
              只依照實際庫存與已開啟策略產生測試事件，不再補入未持有股票。
            </small>
          </div>
          <span className="modeBadge">Alpha 2</span>
        </div>

        <label className="modeSelector">
          <span>模擬策略模式</span>
          <select
            value={strategyMode}
            onChange={(event) =>
              setStrategyMode(event.target.value)
            }
          >
            <option value="long_term">長期投資</option>
            <option value="swing">波段</option>
            <option value="short_term">短線</option>
          </select>
        </label>

        <div className="simulatorExplanation">
          {strategyMode === "long_term" && (
            <span>
              長期模式只追蹤你的實際持股，並優先重視法說、財報、月營收與正式公告。
            </span>
          )}
          {strategyMode === "swing" && (
            <span>
              波段模式會同時重視正式事件、成交量與技術面異動。
            </span>
          )}
          {strategyMode === "short_term" && (
            <span>
              短線模式會提高盤中異動與即時新聞的關注分數。
            </span>
          )}
        </div>

        <div className="simulatorActions">
          <button
            className="tradeButton"
            onClick={simulateTodayMarket}
            disabled={simulating}
          >
            {simulating ? "模擬中…" : "🎲 模擬我的投資組合"}
          </button>

          <button
            className="secondaryButton"
            onClick={clearSimulatorEvents}
            disabled={simulating}
          >
            清除模擬事件
          </button>
        </div>
      </section>

      <details className="card settings">
        <summary>進階：手動新增事件</summary>
        <div className="tradeGrid">
          <Field
            label="股票代號（可空白）"
            value={newEvent.symbol}
            onChange={(value) =>
              setNewEvent({ ...newEvent, symbol: value })
            }
          />

          <label>
            <span>事件類型</span>
            <select
              value={newEvent.event_type}
              onChange={(event) =>
                setNewEvent({
                  ...newEvent,
                  event_type: event.target.value
                })
              }
            >
              <option value="material_announcement">重大訊息</option>
              <option value="investor_conference">法說會</option>
              <option value="earnings">財報</option>
              <option value="monthly_revenue">月營收</option>
              <option value="unusual_price">異常行情</option>
              <option value="industry_news">產業新聞</option>
              <option value="general_news">一般新聞</option>
            </select>
          </label>

          <Field
            label="事件標題"
            value={newEvent.title}
            onChange={(value) =>
              setNewEvent({ ...newEvent, title: value })
            }
          />

          <Field
            label="摘要"
            value={newEvent.summary}
            onChange={(value) =>
              setNewEvent({ ...newEvent, summary: value })
            }
          />

          <Field
            label="重要分數"
            type="number"
            value={newEvent.score}
            onChange={(value) =>
              setNewEvent({
                ...newEvent,
                score: Number(value)
              })
            }
          />

          <Field
            label="可信度"
            type="number"
            value={newEvent.confidence}
            onChange={(value) =>
              setNewEvent({
                ...newEvent,
                confidence: Number(value)
              })
            }
          />
        </div>

        <button className="tradeButton" onClick={addManualEvent}>
          加入 Event Engine
        </button>
      </details>

      <section className="hero card">
        <span>總資產</span>
        <strong>{money(computed.totalAsset)}</strong>
        <div className="daily">
          今日市場變化{" "}
          <b className={computed.dailyTotal >= 0 ? "up" : "down"}>
            {signedMoney(computed.dailyTotal)}
          </b>
        </div>
        <div className="goal">
          <i
            style={{
              width: `${Math.min(
                100,
                computed.totalAsset /
                  Number(data.settings.goal) *
                  100
              )}%`
            }}
          />
        </div>
        <small>
          {money(data.settings.goal)} 目標：
          {(
            computed.totalAsset /
            Number(data.settings.goal) *
            100
          ).toFixed(1)}
          %
        </small>
      </section>

      <section className="two">
        <Metric
          label="股票今日損益"
          value={signedMoney(computed.stockDaily)}
          tone={computed.stockDaily}
          note={`${data.holdings.length} 檔持股`}
        />
        <Metric
          label="黃金今日損益"
          value={signedMoney(computed.goldDaily)}
          tone={computed.goldDaily}
          note={`${data.settings.goldTael} 兩`}
        />
      </section>

      <section className={`card advice ${advice.tone}`}>
        <div>
          <span>大盤距離追蹤高點</span>
          <strong>{computed.drawdown.toFixed(1)}%</strong>
        </div>
        <div className="adviceText">
          <b>
            {data.executedTier === advice.tier && advice.tier
              ? `${advice.title}已執行`
              : advice.title}
          </b>
          <span>
            {advice.amount
              ? money(advice.amount)
              : "照計畫定期定額"}
          </span>

          {advice.tier &&
            data.executedTier !== advice.tier && (
              <button
                onClick={() =>
                  setData((current) => ({
                    ...current,
                    executedTier: advice.tier
                  }))
                }
              >
                標記已執行
              </button>
            )}
        </div>
      </section>

      <section className="card">
        <h2>資產明細</h2>
        <Row label="股票市值" value={money(computed.stockValue)} />
        <Row
          label="股票總損益"
          value={signedMoney(computed.stockTotal)}
          tone={computed.stockTotal}
        />
        <Row label="黃金市值" value={money(computed.goldValue)} />
        <Row
          label="黃金每兩參考價"
          value={money(computed.goldTaelPrice)}
        />
        <Row
          label="投資現金"
          value={money(data.settings.investmentCash)}
        />
        <Row
          label="緊急預備金"
          value={money(data.settings.emergencyFund)}
        />
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <h2>買進登錄</h2>
            <small>輸入成交資料後，自動計算手續費、加入庫存並重算均價。</small>
          </div>
          <span className="modeBadge">
            {data.settings.brokerageDiscount} 折
          </span>
        </div>

        <div className="tradeGrid">
          <Field
            label="股票代號"
            value={trade.symbol}
            onChange={(value) =>
              setTrade({ ...trade, symbol: value.trim() })
            }
          />
          <Field
            label="買進日期"
            type="date"
            value={trade.date}
            onChange={(value) =>
              setTrade({ ...trade, date: value })
            }
          />
          <Field
            label="成交股數"
            type="number"
            value={trade.shares}
            onChange={(value) =>
              setTrade({ ...trade, shares: Number(value) })
            }
          />
          <Field
            label="成交價格"
            type="number"
            step="0.01"
            value={trade.price}
            onChange={(value) =>
              setTrade({ ...trade, price: Number(value) })
            }
          />
        </div>

        <div className="costPreview">
          <Row
            label="成交金額"
            value={money(tradePreview.amount)}
          />
          <Row
            label={`買進手續費（${data.settings.brokerageDiscount} 折）`}
            value={money(tradePreview.fee)}
          />
          <Row
            label="交割總成本"
            value={money(tradePreview.totalCost)}
          />
          <Row
            label="含手續費單位成本"
            value={
              tradePreview.effectiveUnitCost
                ? tradePreview.effectiveUnitCost.toFixed(4)
                : "0"
            }
          />
        </div>

        <button className="tradeButton" onClick={addBuyTransaction}>
          加入庫存並更新均價
        </button>

        {tradeMessage && (
          <div className="tradeMessage">{tradeMessage}</div>
        )}
      </section>

      <section className="card">
        <div className="sectionHeader">
          <h2>持股管理</h2>
          <button
            className="smallButton"
            onClick={() =>
              setData((current) => ({
                ...current,
                holdings: [
                  ...current.holdings,
                  {
                    id: crypto.randomUUID(),
                    symbol: "",
                    shares: 0,
                    averageCost: 0
                  }
                ]
              }))
            }
          >
            新增
          </button>
        </div>

        {computed.holdings.map((holding, index) => (
          <article className="holding" key={holding.id}>
            <div className="holdingTop">
              <div>
                <b>{holding.name || "新持股"}</b>
                <small>
                  {holding.symbol || "尚未填寫代號"}
                </small>
              </div>
              <button
                className="delete"
                onClick={() =>
                  setData((current) => ({
                    ...current,
                    holdings: current.holdings.filter(
                      (item) => item.id !== holding.id
                    )
                  }))
                }
              >
                刪除
              </button>
            </div>

            <div className="holdingGrid">
              <label>
                股票代號
                <input
                  value={holding.symbol}
                  onChange={(event) => {
                    const next = [...data.holdings];
                    next[index] = {
                      ...next[index],
                      symbol: event.target.value.trim()
                    };
                    setData({ ...data, holdings: next });
                  }}
                />
              </label>

              <label>
                股數
                <input
                  type="number"
                  value={holding.shares}
                  onChange={(event) => {
                    const next = [...data.holdings];
                    next[index] = {
                      ...next[index],
                      shares: Number(event.target.value)
                    };
                    setData({ ...data, holdings: next });
                  }}
                />
              </label>

              <label>
                平均成本
                <input
                  type="number"
                  step="0.01"
                  value={holding.averageCost}
                  onChange={(event) => {
                    const next = [...data.holdings];
                    next[index] = {
                      ...next[index],
                      averageCost: Number(event.target.value)
                    };
                    setData({ ...data, holdings: next });
                  }}
                />
              </label>

              <div className="quoteBox">
                <span>現價</span>
                <b>
                  {holding.price
                    ? holding.price.toFixed(2)
                    : "--"}
                </b>
              </div>
            </div>

            <div className="holdingStats">
              <Row
                label="市值"
                value={money(holding.marketValue)}
              />
              <Row
                label="今日損益"
                value={signedMoney(holding.dailyPnl)}
                tone={holding.dailyPnl}
              />
              <Row
                label="總損益"
                value={signedMoney(holding.totalPnl)}
                tone={holding.totalPnl}
              />
              <Row
                label="報酬率"
                value={`${holding.returnPct.toFixed(2)}%`}
                tone={holding.returnPct}
              />
            </div>
          </article>
        ))}
      </section>

      <section className="card">
        <h2>最近買進紀錄</h2>
        {(data.transactions || []).length === 0 ? (
          <div className="empty smallEmpty">
            尚未新增買進紀錄。
          </div>
        ) : (
          <div className="transactionList">
            {(data.transactions || []).slice(0, 20).map(
              (transaction) => (
                <div
                  className="transactionItem"
                  key={transaction.id}
                >
                  <div>
                    <b>
                      {transaction.symbol}・買進{" "}
                      {Number(
                        transaction.shares
                      ).toLocaleString("zh-TW")}{" "}
                      股
                    </b>
                    <small>
                      {transaction.date}｜成交價{" "}
                      {Number(transaction.price).toFixed(2)}
                      ｜手續費 {money(transaction.fee)}
                    </small>
                  </div>
                  <div className="transactionRight">
                    <b>{money(transaction.totalCost)}</b>
                    <button
                      className="deleteText"
                      onClick={() =>
                        deleteTransaction(transaction.id)
                      }
                    >
                      刪除紀錄
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
        <small className="warningText">
          刪除交易紀錄不會回復庫存；如輸入錯誤，請同時到持股管理修正股數與均價。
        </small>
      </section>

      <section className="card">
        <h2>資產成長</h2>
        <MiniChart data={data.snapshots || []} />
        <small>
          資產快照已改存 Supabase，手機與電腦共用。
        </small>
      </section>

      <details className="card settings">
        <summary>其他設定</summary>

        <Field
          label="證券手續費折數"
          type="number"
          step="0.1"
          value={data.settings.brokerageDiscount}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                brokerageDiscount: Number(value)
              }
            })
          }
        />

        <Field
          label="每筆最低手續費"
          type="number"
          value={data.settings.minimumFee}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                minimumFee: Number(value)
              }
            })
          }
        />

        <p className="hint">
          例如券商 2 折請填 2；若零股最低手續費為 1 元，可自行把最低手續費改成 1。
        </p>

        <Field
          label="投資現金"
          type="number"
          value={data.settings.investmentCash}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                investmentCash: Number(value)
              }
            })
          }
        />

        <Field
          label="緊急預備金"
          type="number"
          value={data.settings.emergencyFund}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                emergencyFund: Number(value)
              }
            })
          }
        />

        <Field
          label="黃金持有（兩）"
          type="number"
          step="0.1"
          value={data.settings.goldTael}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                goldTael: Number(value)
              }
            })
          }
        />

        <Field
          label="黃金手動備援價（每兩）"
          type="number"
          value={data.settings.manualGoldTaelPrice}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                manualGoldTaelPrice: Number(value)
              }
            })
          }
        />

        <Field
          label="加權指數參考高點"
          type="number"
          value={data.settings.taiexHigh}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                taiexHigh: Number(value)
              }
            })
          }
        />

        <Field
          label="資產目標"
          type="number"
          value={data.settings.goal}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                goal: Number(value)
              }
            })
          }
        />
      </details>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <h2>策略中心</h2>
            <small>只顯示目前正在執行的策略。</small>
          </div>
          <span className="modeBadge">穩定累積</span>
        </div>

        <StrategyToggle
          label="009816 定期定額"
          description="每月 7、14、21、28 日各 NT$4,000"
          checked={strategy.recurring009816}
          onChange={(checked) =>
            setData({
              ...data,
              strategies: {
                ...strategy,
                recurring009816: checked
              }
            })
          }
        />

        <StrategyToggle
          label="大盤 -10% / -20% / -30% 回檔提醒"
          description="保留大盤提醒，但不等於一定要買正2"
          checked={strategy.marketDrawdownReminder}
          onChange={(checked) =>
            setData({
              ...data,
              strategies: {
                ...strategy,
                marketDrawdownReminder: checked
              }
            })
          }
        />

        <StrategyToggle
          label="正2 加碼策略"
          description="目前關閉；重新勾選後才顯示正2加碼語句"
          checked={strategy.leveragedEtf}
          onChange={(checked) =>
            setData({
              ...data,
              strategies: {
                ...strategy,
                leveragedEtf: checked
              }
            })
          }
        />

        <StrategyToggle
          label="黃金持續買進"
          description="目前關閉；維持既有 2.1 兩，不主動新增"
          checked={strategy.goldBuying}
          onChange={(checked) =>
            setData({
              ...data,
              strategies: {
                ...strategy,
                goldBuying: checked
              }
            })
          }
        />

        <StrategyToggle
          label="緊急預備金管理"
          description="維持 20～30 萬安全緩衝"
          checked={strategy.emergencyFund}
          onChange={(checked) =>
            setData({
              ...data,
              strategies: {
                ...strategy,
                emergencyFund: checked
              }
            })
          }
        />

        <StrategyToggle
          label="投資日誌"
          description="保留未來的操作與決策紀錄模組"
          checked={strategy.investmentJournal}
          onChange={(checked) =>
            setData({
              ...data,
              strategies: {
                ...strategy,
                investmentJournal: checked
              }
            })
          }
        />

        <div className="strategySummary">
          <b>目前策略</b>
          <span>
            {strategy.recurring009816
              ? "009816 固定投入；"
              : "009816 定期定額暫停；"}
            {strategy.goldBuying
              ? "黃金買進開啟；"
              : "黃金維持持有、不新增；"}
            {strategy.leveragedEtf
              ? "正2策略開啟。"
              : "正2策略暫停。"}
          </span>
        </div>
      </section>

      {strategy.recurring009816 && (
      <section className="card plan">
        <h2>009816 定期定額</h2>
        <div>7 日　NT$4,000</div>
        <div>14 日　NT$4,000</div>
        <div>21 日　NT$4,000</div>
        <div>28 日　NT$4,000</div>
        <small>
          每月合計 NT$16,000，其餘資金保留現金。
        </small>
      </section>
      )}
    </main>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const result =
      mode === "signup"
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: window.location.origin
            }
          })
        : await supabase.auth.signInWithPassword({
            email,
            password
          });

    if (result.error) {
      setMessage(result.error.message);
    } else if (mode === "signup" && !result.data.session) {
      setMessage("註冊完成，請到信箱點確認連結後再登入。");
    } else {
      setMessage("登入成功");
    }

    setBusy(false);
  }

  async function loginWithGoogle() {
    setBusy(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) {
      setMessage(
        "Google 登入尚未啟用，可先使用 Email 註冊登入。"
      );
      setBusy(false);
    }
  }

  return (
    <main className="loginPage">
      <section className="loginCard">
        <h1>Jay Invest</h1>
        <p>登入後，手機與電腦會共用同一份資料。</p>

        <button
          className="googleButton"
          onClick={loginWithGoogle}
          disabled={busy}
        >
          使用 Google 登入
        </button>

        <div className="divider">
          <span>或使用 Email</span>
        </div>

        <form onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
            />
          </label>

          <label>
            密碼（至少 6 碼）
            <input
              type="password"
              minLength={6}
              required
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
            />
          </label>

          <button
            className="loginButton"
            type="submit"
            disabled={busy}
          >
            {busy
              ? "處理中…"
              : mode === "signup"
              ? "建立帳號"
              : "登入"}
          </button>
        </form>

        <button
          className="switchMode"
          onClick={() =>
            setMode(mode === "signup" ? "login" : "signup")
          }
        >
          {mode === "signup"
            ? "已有帳號？切換登入"
            : "第一次使用？建立帳號"}
        </button>

        {message && <div className="authMessage">{message}</div>}
      </section>
    </main>
  );
}

function StrategyToggle({
  label,
  description,
  checked,
  onChange
}) {
  return (
    <label className="strategyToggle">
      <div>
        <b>{label}</b>
        <small>{description}</small>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function Metric({ label, value, tone, note }) {
  return (
    <article className="card metric">
      <span>{label}</span>
      <strong className={tone >= 0 ? "up" : "down"}>
        {value}
      </strong>
      <small>{note}</small>
    </article>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="row">
      <span>{label}</span>
      <b
        className={
          tone === undefined ? "" : tone >= 0 ? "up" : "down"
        }
      >
        {value}
      </b>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  step
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function MiniChart({ data }) {
  if (!data || data.length < 2) {
    return (
      <div className="empty">
        累積兩天雲端資料後顯示資產曲線。
      </div>
    );
  }

  const values = data.map((item) => item.total);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const points = data
    .map((item, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y =
        92 -
        ((item.total - min) / Math.max(1, max - min)) * 84;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="chart"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
    </svg>
  );
}
