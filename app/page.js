"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
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
    minimumFee: 20,
    reserveCash: 0,
    rebalanceStockTarget: 60,
    rebalanceCashTarget: 40,
    rebalanceTolerance: 5,
    wealthGoalAmount: 2000000,
    wealthGoalDate: "2027-07-18",
    monthlyContribution: 30000
  },
  snapshots: [],
  transactions: [],
  cashLedger: [],
  executedTier: "",
  strategies: {
    recurring009816: false,
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

const importanceLabel = (score) => {
  const n = Number(score) || 0;
  if (n >= 90) return "非常重要";
  if (n >= 70) return "高重要";
  if (n >= 40) return "中等";
  return "低重要";
};

const confidenceLabel = (confidence) => {
  const n = Number(confidence) || 0;
  if (n >= 90) return "高可信";
  if (n >= 70) return "中高可信";
  if (n >= 50) return "可信度普通";
  return "需再查證";
};

const starRating = (value) => {
  const stars = Math.max(
    1,
    Math.min(5, Math.ceil((Number(value) || 0) / 20))
  );
  return `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
};

const readMinutes = (score) => {
  const n = Number(score) || 0;
  if (n >= 90) return 3;
  if (n >= 70) return 2;
  if (n >= 40) return 1;
  return 0;
};

const decisionStatusText = (status) => {
  if (status === "red") return "建議立即注意";
  if (status === "yellow") return "值得關注";
  return "維持原策略";
};

const decisionActionText = (status) => {
  if (status === "red") return "建議重新評估";
  if (status === "yellow") return "目前不用調整";
  return "今天不需要變動";
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
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantAnswer, setAssistantAnswer] = useState("");
  const [showDecisionReasons, setShowDecisionReasons] = useState(false);
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
    type: "buy",
    symbol: "",
    shares: 0,
    price: 0,
    date: new Date().toISOString().slice(0, 10),
    cashAmount: 0,
    note: ""
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
      const nextData = {
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
          : [],
        cashLedger: Array.isArray(row.data.cashLedger)
          ? row.data.cashLedger
          : []
      };

      setData(nextData);
      await loadEvents(userId, nextData.holdings || []);
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
        transactions: [],
        cashLedger: []
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


  async function loadEvents(userId, holdingsOverride = null) {
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
      const holdingSymbols = new Set(
        (holdingsOverride || data.holdings || [])
          .filter((holding) => Number(holding.shares) > 0)
          .map((holding) => String(holding.symbol || "").trim())
          .filter(Boolean)
      );

      const holdingsOnly = (rows || [])
        .filter(
          (event) =>
            event.symbol &&
            holdingSymbols.has(String(event.symbol).trim())
        )
        .map(normalizeEvent);

      setEvents(holdingsOnly);
      setEventMessage("");
    }

    setEventsLoading(false);
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
    const discount =
      Math.max(0, Number(data.settings.brokerageDiscount) || 0) / 10;
    const calculatedFee = amount * 0.001425 * discount;
    const fee =
      amount > 0
        ? Math.max(
            Number(data.settings.minimumFee) || 0,
            Math.round(calculatedFee)
          )
        : 0;
    const tax =
      trade.type === "sell"
        ? Math.round(amount * 0.003)
        : 0;
    const cashChange =
      trade.type === "buy"
        ? -(amount + fee)
        : trade.type === "sell"
        ? amount - fee - tax
        : trade.type === "cash_in"
        ? Number(trade.cashAmount) || 0
        : -(Number(trade.cashAmount) || 0);

    return {
      amount,
      fee,
      tax,
      cashChange,
      settlementAmount: Math.abs(cashChange),
      effectiveUnitCost:
        shares > 0 && trade.type === "buy"
          ? (amount + fee) / shares
          : shares > 0 && trade.type === "sell"
          ? (amount - fee - tax) / shares
          : 0
    };
  }, [
    trade,
    data.settings.brokerageDiscount,
    data.settings.minimumFee
  ]);

  const investableCash = Math.max(
    0,
    Number(data.settings.investmentCash || 0) -
      Number(data.settings.reserveCash || 0)
  );

  const projectedCash =
    Number(data.settings.investmentCash || 0) +
    tradePreview.cashChange;

  const projectedInvestableCash = Math.max(
    0,
    projectedCash - Number(data.settings.reserveCash || 0)
  );

  function recalculateHoldingFromTransactions(symbol, transactions) {
    const relevant = transactions
      .filter(
        (item) =>
          item.symbol === symbol &&
          ["buy", "sell"].includes(item.type)
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt || a.date) -
          new Date(b.createdAt || b.date)
      );

    let shares = 0;
    let costBasis = 0;

    for (const item of relevant) {
      const qty = Number(item.shares) || 0;

      if (item.type === "buy") {
        shares += qty;
        costBasis += Number(item.totalCost) || 0;
      } else if (item.type === "sell" && shares > 0) {
        const sellQty = Math.min(qty, shares);
        const averageCost = costBasis / shares;
        costBasis -= averageCost * sellQty;
        shares -= sellQty;
      }
    }

    return {
      shares,
      averageCost: shares > 0 ? costBasis / shares : 0
    };
  }

  function rebuildHoldingsFromTransactions(transactions, currentHoldings) {
    const symbols = [
      ...new Set(
        transactions
          .filter((item) => item.symbol)
          .map((item) => item.symbol)
      )
    ];

    const currentMap = Object.fromEntries(
      currentHoldings.map((holding) => [holding.symbol, holding])
    );

    return symbols
      .map((symbol) => {
        const result = recalculateHoldingFromTransactions(
          symbol,
          transactions
        );

        return {
          id: currentMap[symbol]?.id || crypto.randomUUID(),
          symbol,
          shares: result.shares,
          averageCost: Number(result.averageCost.toFixed(6))
        };
      })
      .filter((holding) => holding.shares > 0);
  }

  function submitTransaction() {
    const type = trade.type;
    const now = new Date().toISOString();
    const currentCash = Number(data.settings.investmentCash) || 0;

    if (["cash_in", "cash_out"].includes(type)) {
      const amount = Number(trade.cashAmount) || 0;

      if (amount <= 0) {
        setTradeMessage("請輸入現金金額。");
        return;
      }

      if (type === "cash_out" && amount > currentCash) {
        setTradeMessage("現金不足，無法登錄這筆支出。");
        return;
      }

      const transaction = {
        id: crypto.randomUUID(),
        type,
        date: trade.date,
        cashChange: tradePreview.cashChange,
        note: trade.note || (type === "cash_in" ? "現金收入" : "現金支出"),
        createdAt: now
      };

      setData({
        ...data,
        settings: {
          ...data.settings,
          investmentCash: currentCash + tradePreview.cashChange
        },
        transactions: [
          transaction,
          ...(data.transactions || [])
        ],
        cashLedger: [
          {
            id: crypto.randomUUID(),
            transactionId: transaction.id,
            type,
            amount: tradePreview.cashChange,
            balanceAfter: currentCash + tradePreview.cashChange,
            note: transaction.note,
            date: trade.date,
            createdAt: now
          },
          ...(data.cashLedger || [])
        ]
      });

      setTradeMessage(
        `${type === "cash_in" ? "現金收入" : "現金支出"}已登錄，現金餘額自動更新。`
      );

      setTrade({
        ...trade,
        cashAmount: 0,
        note: ""
      });
      return;
    }

    const symbol = trade.symbol.trim();
    const shares = Math.floor(Number(trade.shares) || 0);
    const price = Number(trade.price) || 0;

    if (!symbol || shares <= 0 || price <= 0) {
      setTradeMessage("請輸入股票代號、股數與成交價格。");
      return;
    }

    const existingHolding = (data.holdings || []).find(
      (holding) => holding.symbol === symbol
    );

    if (type === "sell") {
      if (!existingHolding || Number(existingHolding.shares) < shares) {
        setTradeMessage("賣出股數超過目前庫存。");
        return;
      }
    }

    if (type === "buy" && currentCash + tradePreview.cashChange < 0) {
      setTradeMessage("可用現金不足，無法完成這筆買進。");
      return;
    }

    const averageCostBefore =
      Number(existingHolding?.averageCost) || 0;
    const realizedPnl =
      type === "sell"
        ? tradePreview.cashChange -
          shares * averageCostBefore
        : 0;

    const transaction = {
      id: crypto.randomUUID(),
      type,
      symbol,
      shares,
      price,
      amount: tradePreview.amount,
      fee: tradePreview.fee,
      tax: tradePreview.tax,
      totalCost:
        type === "buy"
          ? tradePreview.amount + tradePreview.fee
          : 0,
      netProceeds:
        type === "sell"
          ? tradePreview.cashChange
          : 0,
      cashChange: tradePreview.cashChange,
      realizedPnl,
      averageCostBefore,
      date: trade.date,
      note: trade.note,
      createdAt: now
    };

    const nextTransactions = [
      transaction,
      ...(data.transactions || [])
    ];

    const holdingBefore = existingHolding
      ? {
          id: existingHolding.id,
          symbol: existingHolding.symbol,
          shares: Number(existingHolding.shares) || 0,
          averageCost: Number(existingHolding.averageCost) || 0
        }
      : null;

    let nextHoldings;

    if (type === "buy") {
      const previousShares = Number(existingHolding?.shares) || 0;
      const previousAverageCost =
        Number(existingHolding?.averageCost) || 0;
      const newShares = previousShares + shares;
      const newAverageCost =
        newShares > 0
          ? (
              previousShares * previousAverageCost +
              tradePreview.amount +
              tradePreview.fee
            ) / newShares
          : 0;

      if (existingHolding) {
        nextHoldings = (data.holdings || []).map((holding) =>
          holding.id === existingHolding.id
            ? {
                ...holding,
                shares: newShares,
                averageCost: Number(newAverageCost.toFixed(6))
              }
            : holding
        );
      } else {
        nextHoldings = [
          ...(data.holdings || []),
          {
            id: crypto.randomUUID(),
            symbol,
            shares: newShares,
            averageCost: Number(newAverageCost.toFixed(6))
          }
        ];
      }
    } else {
      const remainingShares =
        (Number(existingHolding?.shares) || 0) - shares;

      nextHoldings =
        remainingShares > 0
          ? (data.holdings || []).map((holding) =>
              holding.id === existingHolding.id
                ? {
                    ...holding,
                    shares: remainingShares
                  }
                : holding
            )
          : (data.holdings || []).filter(
              (holding) => holding.id !== existingHolding.id
            );
    }

    transaction.holdingBefore = holdingBefore;

    const nextCash = currentCash + tradePreview.cashChange;

    setData({
      ...data,
      settings: {
        ...data.settings,
        investmentCash: nextCash
      },
      holdings: nextHoldings,
      transactions: nextTransactions,
      cashLedger: [
        {
          id: crypto.randomUUID(),
          transactionId: transaction.id,
          type,
          symbol,
          amount: tradePreview.cashChange,
          balanceAfter: nextCash,
          note:
            trade.note ||
            `${type === "buy" ? "買進" : "賣出"} ${symbol}`,
          date: trade.date,
          createdAt: now
        },
        ...(data.cashLedger || [])
      ]
    });

    setTradeMessage(
      type === "buy"
        ? `已買進 ${symbol} ${shares.toLocaleString("zh-TW")} 股，現金、庫存與均價已同步更新。`
        : `已賣出 ${symbol} ${shares.toLocaleString("zh-TW")} 股，現金與已實現損益已同步更新。`
    );

    setTrade({
      ...trade,
      symbol: "",
      shares: 0,
      price: 0,
      note: ""
    });
  }

  function undoTransaction(transactionId) {
    const transaction = (data.transactions || []).find(
      (item) => item.id === transactionId
    );

    if (!transaction) return;

    const nextTransactions = (data.transactions || []).filter(
      (item) => item.id !== transactionId
    );

    let nextHoldings = [...(data.holdings || [])];

    if (["buy", "sell"].includes(transaction.type)) {
      const before = transaction.holdingBefore;
      const currentIndex = nextHoldings.findIndex(
        (holding) => holding.symbol === transaction.symbol
      );

      if (before) {
        if (currentIndex >= 0) {
          nextHoldings[currentIndex] = {
            ...nextHoldings[currentIndex],
            id: before.id || nextHoldings[currentIndex].id,
            symbol: before.symbol,
            shares: before.shares,
            averageCost: before.averageCost
          };
        } else {
          nextHoldings.push({
            id: before.id || crypto.randomUUID(),
            symbol: before.symbol,
            shares: before.shares,
            averageCost: before.averageCost
          });
        }
      } else if (transaction.type === "buy" && currentIndex >= 0) {
        const current = nextHoldings[currentIndex];
        const remainingShares =
          Number(current.shares || 0) -
          Number(transaction.shares || 0);

        if (remainingShares > 0) {
          const remainingCost =
            Number(current.shares || 0) *
              Number(current.averageCost || 0) -
            Number(transaction.totalCost || 0);

          nextHoldings[currentIndex] = {
            ...current,
            shares: remainingShares,
            averageCost: Math.max(
              0,
              Number((remainingCost / remainingShares).toFixed(6))
            )
          };
        } else {
          nextHoldings.splice(currentIndex, 1);
        }
      } else if (transaction.type === "sell") {
        const restoredShares =
          Number(transaction.shares || 0) +
          (currentIndex >= 0
            ? Number(nextHoldings[currentIndex].shares || 0)
            : 0);

        const restoredHolding = {
          id:
            currentIndex >= 0
              ? nextHoldings[currentIndex].id
              : crypto.randomUUID(),
          symbol: transaction.symbol,
          shares: restoredShares,
          averageCost: Number(transaction.averageCostBefore || 0)
        };

        if (currentIndex >= 0) {
          nextHoldings[currentIndex] = restoredHolding;
        } else {
          nextHoldings.push(restoredHolding);
        }
      }
    }

    const currentCash = Number(data.settings.investmentCash) || 0;
    const revertedCash =
      currentCash - Number(transaction.cashChange || 0);

    setData({
      ...data,
      settings: {
        ...data.settings,
        investmentCash: revertedCash
      },
      holdings: nextHoldings,
      transactions: nextTransactions,
      cashLedger: [
        {
          id: crypto.randomUUID(),
          transactionId,
          type: "undo",
          amount: -Number(transaction.cashChange || 0),
          balanceAfter: revertedCash,
          note: `復原交易：${
            transaction.symbol || transaction.note || transaction.type
          }`,
          date: new Date().toISOString().slice(0, 10),
          createdAt: new Date().toISOString()
        },
        ...(data.cashLedger || [])
      ]
    });

    setTradeMessage("交易已復原，現金、庫存與均價已重新計算。");
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



  const holdingSymbolSet = new Set(
    (data.holdings || [])
      .filter((holding) => Number(holding.shares) > 0)
      .map((holding) => String(holding.symbol || "").trim())
      .filter(Boolean)
  );

  function getPortfolioImpact(event) {
    if (event.symbol && holdingSymbolSet.has(event.symbol)) {
      return {
        score: Math.min(100, Math.max(80, Number(event.score) || 0)),
        label: "直接影響持股",
        tone: "high"
      };
    }

    if (!event.symbol || event.symbol === "MARKET") {
      return {
        score: Math.max(40, Math.min(75, Number(event.score) || 0)),
        label: "影響整體市場",
        tone: "medium"
      };
    }

    return {
      score: 20,
      label: "非目前持股",
      tone: "low"
    };
  }

  function getEventRecommendation(event) {
    const impact = getPortfolioImpact(event);
    const score = Number(event.score) || 0;

    if (impact.score >= 80 && score >= 80) {
      return {
        title: "今天建議閱讀",
        detail: "屬於高重要性且直接影響持股的事件，建議查看來源並重新檢視投資假設。",
        tone: "red"
      };
    }

    if (impact.score >= 60 || score >= 60) {
      return {
        title: "值得關注",
        detail: "目前不足以直接改變策略，但建議花幾分鐘了解事件內容。",
        tone: "yellow"
      };
    }

    return {
      title: "了解即可",
      detail: "目前對投資組合影響有限，不需要立即操作。",
      tone: "green"
    };
  }

  function getScoreBreakdown(event) {
    const officialPoints =
      event.source_type === "official"
        ? 35
        : event.source_type === "reliable_media"
        ? 22
        : 10;

    const typePoints =
      event.event_type === "material_announcement"
        ? 35
        : event.event_type === "investor_conference"
        ? 30
        : event.event_type === "earnings"
        ? 28
        : event.event_type === "monthly_revenue"
        ? 22
        : event.event_type === "unusual_price"
        ? 16
        : 10;

    const confidencePoints = Math.round(
      (Number(event.confidence) || 0) * 0.2
    );

    const portfolioPoints =
      getPortfolioImpact(event).score >= 80 ? 20 : 8;

    const raw =
      officialPoints +
      typePoints +
      confidencePoints +
      portfolioPoints;

    return {
      officialPoints,
      typePoints,
      confidencePoints,
      portfolioPoints,
      total: Math.min(100, raw)
    };
  }


  const realizedPnlTotal = (data.transactions || [])
    .filter((item) => item.type === "sell")
    .reduce(
      (sum, item) => sum + Number(item.realizedPnl || 0),
      0
    );

  const sellTransactions = (data.transactions || []).filter(
    (item) => item.type === "sell"
  );

  const profitableTrades = sellTransactions.filter(
    (item) => Number(item.realizedPnl || 0) > 0
  ).length;

  const winRate =
    sellTransactions.length > 0
      ? (profitableTrades / sellTransactions.length) * 100
      : 0;

  const cashUsageRate =
    Number(data.settings.investmentCash || 0) +
      computed.stockValue >
    0
      ? (computed.stockValue /
          (Number(data.settings.investmentCash || 0) +
            computed.stockValue)) *
        100
      : 0;


  const rebalanceInvestableTotal =
    computed.stockValue + investableCash;

  const currentStockRatio =
    rebalanceInvestableTotal > 0
      ? (computed.stockValue / rebalanceInvestableTotal) * 100
      : 0;

  const currentCashRatio =
    rebalanceInvestableTotal > 0
      ? (investableCash / rebalanceInvestableTotal) * 100
      : 0;

  const stockTarget = Math.max(
    0,
    Math.min(100, Number(data.settings.rebalanceStockTarget) || 60)
  );

  const cashTarget = 100 - stockTarget;

  const rebalanceTolerance = Math.max(
    0,
    Number(data.settings.rebalanceTolerance) || 0
  );

  const targetStockValue =
    rebalanceInvestableTotal * (stockTarget / 100);

  const rebalanceAmount =
    computed.stockValue - targetStockValue;

  const needsRebalance =
    strategy.leveragedEtf &&
    rebalanceInvestableTotal > 0 &&
    Math.abs(currentStockRatio - stockTarget) >
      rebalanceTolerance;

  const rebalanceDirection =
    rebalanceAmount > 0 ? "reduce_stock" : "increase_stock";

  const strategyForDecision = {
    ...cloneDefaultData().strategies,
    ...(data.strategies || {})
  };

  const decisionSummary = buildDecisionSummary(
    events,
    strategyForDecision
  );


  const officialEvents = events.filter(
    (event) => event.source_type === "official"
  );
  const reliableMediaEvents = events.filter(
    (event) => event.source_type === "reliable_media"
  );
  const conflictingEvents = events.filter(
    (event) => event.has_conflict === true
  );
  const directImpactEvents = events.filter(
    (event) => getPortfolioImpact(event).score >= 80
  );
  const highPriorityEvents = events.filter(
    (event) => Number(event.score) >= 80
  );

  const decisionConfidence = Math.max(
    35,
    Math.min(
      99,
      Math.round(
        45 +
          officialEvents.length * 8 +
          reliableMediaEvents.length * 4 +
          directImpactEvents.length * 3 -
          conflictingEvents.length * 12
      )
    )
  );

  const decisionReasons = [
    officialEvents.length > 0
      ? `有 ${officialEvents.length} 件官方資料`
      : "目前沒有新的官方重大公告",
    directImpactEvents.length > 0
      ? `有 ${directImpactEvents.length} 件直接影響持股`
      : "沒有事件直接改變目前持股策略",
    highPriorityEvents.length > 0
      ? `有 ${highPriorityEvents.length} 件高重要事件`
      : "沒有高重要事件",
    conflictingEvents.length > 0
      ? "部分來源互相矛盾，建議等待官方資訊"
      : "目前沒有偵測到來源衝突"
  ];

  const topDecisionEvents = [...events]
    .sort((a, b) => {
      const aImpact = getPortfolioImpact(a).score;
      const bImpact = getPortfolioImpact(b).score;
      return (
        Number(b.score) + bImpact -
        (Number(a.score) + aImpact)
      );
    })
    .slice(0, 3);


  const activeHoldingSymbols = (data.holdings || [])
    .filter((holding) => Number(holding.shares) > 0)
    .map((holding) => String(holding.symbol || "").trim())
    .filter(Boolean);

  const topRelevantEvent = [...events]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];

  const aiDecisionStatus = needsRebalance
    ? "rebalance"
    : decisionSummary.status === "red"
    ? "review"
    : events.some((event) => Number(event.score || 0) >= 60)
    ? "watch"
    : "hold";

  const aiDecisionLabel =
    aiDecisionStatus === "rebalance"
      ? "需要調節"
      : aiDecisionStatus === "review"
      ? "建議重新檢視"
      : aiDecisionStatus === "watch"
      ? "建議關注"
      : "不需要";

  const aiOneLine =
    aiDecisionStatus === "rebalance"
      ? "正2平衡策略已偏離容忍區間，建議查看調節金額。"
      : aiDecisionStatus === "review"
      ? "今天有高重要事件，建議先查看事件中心。"
      : aiDecisionStatus === "watch"
      ? "今天有持股事件值得留意，但目前不足以改變原策略。"
      : events.length > 0
      ? `今天共有 ${events.length} 件持股事件，但目前不需要改變策略。`
      : "今天沒有影響持股的重要事件，維持原策略即可。";

  const aiDecisionReasons = [
    activeHoldingSymbols.length > 0
      ? `目前追蹤 ${activeHoldingSymbols.length} 檔實際持股`
      : "目前沒有有效持股",
    events.length > 0
      ? `今日共有 ${events.length} 件持股事件`
      : "今日沒有新的持股事件",
    topRelevantEvent
      ? `最高重要事件為 ${topRelevantEvent.symbol}，分數 ${topRelevantEvent.score}`
      : "沒有事件需要優先閱讀",
    strategy.leveragedEtf
      ? needsRebalance
        ? "正2平衡策略已超出容忍區間"
        : "正2平衡策略仍在容忍區間"
      : "正2平衡策略未啟用",
    `可投資現金為 ${money(investableCash)}`
  ];

  function answerAssistantQuestion() {
    const question = assistantQuestion.trim().toLowerCase();

    if (!question) {
      setAssistantAnswer("請先輸入問題。");
      return;
    }

    if (
      question.includes("現金") ||
      question.includes("資金") ||
      question.includes("加碼")
    ) {
      setAssistantAnswer(
        `目前可投資現金為 ${money(
          investableCash
        )}。緊急預備金不會被列入投資或加碼資金。${
          investableCash <= 0
            ? "目前不建議新增部位。"
            : "新增交易前可先查看 Cash Engine 的交易後餘額預估。"
        }`
      );
      return;
    }

    if (
      question.includes("變動") ||
      question.includes("操作") ||
      question.includes("今天")
    ) {
      setAssistantAnswer(
        `今天的結論是「${aiDecisionLabel}」。${aiOneLine}`
      );
      return;
    }

    if (
      question.includes("哪一檔") ||
      question.includes("重要") ||
      question.includes("事件")
    ) {
      setAssistantAnswer(
        topRelevantEvent
          ? `目前最值得先看的是 ${topRelevantEvent.symbol}：${topRelevantEvent.title}，事件重要分數 ${topRelevantEvent.score}。`
          : "目前沒有新的持股事件需要優先查看。"
      );
      return;
    }

    if (
      question.includes("比例") ||
      question.includes("平衡") ||
      question.includes("正2")
    ) {
      setAssistantAnswer(
        strategy.leveragedEtf
          ? `目前股票比例 ${currentStockRatio.toFixed(
              1
            )}%，可投資現金比例 ${currentCashRatio.toFixed(
              1
            )}%。目標為 ${stockTarget.toFixed(
              0
            )}/${cashTarget.toFixed(0)}，${
              needsRebalance
                ? `建議調節約 ${money(Math.abs(rebalanceAmount))}。`
                : "目前仍在容忍區間內。"
            }`
          : "正2平衡策略目前未啟用，因此不產生調節建議。"
      );
      return;
    }

    if (
      question.includes("風險") ||
      question.includes("利空") ||
      question.includes("新聞")
    ) {
      const highRisk = events.filter(
        (event) => Number(event.score || 0) >= 80
      );
      setAssistantAnswer(
        highRisk.length > 0
          ? `目前有 ${highRisk.length} 件高重要持股事件，建議查看事件中心。`
          : "目前沒有偵測到高重要持股事件。"
      );
      return;
    }

    setAssistantAnswer(
      `目前結論是「${aiDecisionLabel}」。你也可以問：今天需要變動嗎、可投資現金多少、哪一檔最重要、正2是否需要平衡。`
    );
  }


  const wealthGoalAmount = Math.max(
    0,
    Number(data.settings.wealthGoalAmount) || 0
  );
  const wealthGoalProgress =
    wealthGoalAmount > 0
      ? Math.min(100, (computed.totalAssets / wealthGoalAmount) * 100)
      : 0;
  const wealthGoalGap = Math.max(
    0,
    wealthGoalAmount - computed.totalAssets
  );
  const wealthGoalDate = data.settings.wealthGoalDate
    ? new Date(`${data.settings.wealthGoalDate}T00:00:00`)
    : null;
  const monthsToGoal =
    wealthGoalDate && !Number.isNaN(wealthGoalDate.getTime())
      ? Math.max(
          0,
          Math.ceil(
            (wealthGoalDate.getTime() - Date.now()) /
              (1000 * 60 * 60 * 24 * 30.4375)
          )
        )
      : 0;
  const requiredMonthlyContribution =
    monthsToGoal > 0 ? wealthGoalGap / monthsToGoal : wealthGoalGap;
  const plannedMonthlyContribution = Math.max(
    0,
    Number(data.settings.monthlyContribution) || 0
  );
  const goalPaceStatus =
    wealthGoalGap <= 0
      ? "completed"
      : plannedMonthlyContribution >= requiredMonthlyContribution
      ? "on_track"
      : "behind";

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
          <p>V6 Wealth Assistant・Simple Decision</p>
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

      <section
        className={`card simpleV6Decision ${
          needsRebalance || decisionSummary.status === "red"
            ? "yellow"
            : "green"
        }`}
      >
        <span className="eyebrow">今天需要變動？</span>

        <div className="simpleV6Answer">
          <span
            className={`decisionDot ${
              needsRebalance || decisionSummary.status === "red"
                ? "yellow"
                : "green"
            }`}
          />
          <strong>
            {needsRebalance || decisionSummary.status === "red"
              ? "需要"
              : "不需要"}
          </strong>
        </div>

        {strategy.leveragedEtf && (
          <div className="simpleRebalanceBox">
            <div>
              <span>正2平衡</span>
              <b>{needsRebalance ? "需要調整" : "不用調整"}</b>
            </div>

            {needsRebalance && (
              <div>
                <span>建議調整金額</span>
                <b>{money(Math.abs(rebalanceAmount))}</b>
              </div>
            )}
          </div>
        )}
      </section>


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

      <section className="card wealthGoalCard">
        <div className="sectionHeader">
          <div>
            <h2>V6 財富目標</h2>
            <small>依目前總資產、目標日期與每月投入估算進度。</small>
          </div>
          <span
            className={`goalStatus ${goalPaceStatus}`}
          >
            {goalPaceStatus === "completed"
              ? "已達成"
              : goalPaceStatus === "on_track"
              ? "進度正常"
              : "需提高投入"}
          </span>
        </div>

        <div className="goalHeadline">
          <div>
            <span>目前總資產</span>
            <b>{money(computed.totalAssets)}</b>
          </div>
          <div>
            <span>財富目標</span>
            <b>{money(wealthGoalAmount)}</b>
          </div>
        </div>

        <div className="goalProgressTrack">
          <span style={{ width: `${wealthGoalProgress}%` }} />
        </div>

        <div className="goalStats">
          <div>
            <span>完成率</span>
            <b>{wealthGoalProgress.toFixed(1)}%</b>
          </div>
          <div>
            <span>距離目標</span>
            <b>{money(wealthGoalGap)}</b>
          </div>
          <div>
            <span>剩餘月份</span>
            <b>{monthsToGoal} 個月</b>
          </div>
          <div>
            <span>每月所需投入</span>
            <b>{money(Math.ceil(requiredMonthlyContribution))}</b>
          </div>
        </div>

        <div className="goalAdvice">
          <b>Jay AI 財富進度</b>
          <span>
            {goalPaceStatus === "completed"
              ? "你已達成目前設定的財富目標。"
              : goalPaceStatus === "on_track"
              ? `依每月投入 ${money(
                  plannedMonthlyContribution
                )} 的計畫，目前進度大致正常。`
              : `依目前目標與期限，每月約需投入 ${money(
                  Math.ceil(requiredMonthlyContribution)
                )}；目前設定為 ${money(
                  plannedMonthlyContribution
                )}。`}
          </span>
        </div>
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <h2>Cash Engine｜新增交易</h2>
            <small>
              買進、賣出、收入與支出都會自動更新現金、庫存、均價及損益。
            </small>
          </div>
          <span className="modeBadge">V3.3</span>
        </div>

        <div className="tradeTypeTabs">
          {[
            ["buy", "買進"],
            ["sell", "賣出"],
            ["cash_in", "現金收入"],
            ["cash_out", "現金支出"]
          ].map(([value, label]) => (
            <button
              key={value}
              className={trade.type === value ? "active" : ""}
              onClick={() =>
                setTrade({
                  ...trade,
                  type: value,
                  symbol: "",
                  shares: 0,
                  price: 0,
                  cashAmount: 0,
                  note: ""
                })
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="cashEngineSummary">
          <div>
            <span>現金餘額</span>
            <b>{money(data.settings.investmentCash)}</b>
          </div>
          <div>
            <span>保留現金</span>
            <b>{money(data.settings.reserveCash)}</b>
          </div>
          <div>
            <span>可投資現金</span>
            <b>{money(investableCash)}</b>
          </div>
          <div>
            <span>交易後可投資</span>
            <b
              className={
                projectedInvestableCash <= 0 ? "down" : "up"
              }
            >
              {money(projectedInvestableCash)}
            </b>
          </div>
        </div>

        {["buy", "sell"].includes(trade.type) ? (
          <>
            <div className="tradeGrid">
              <Field
                label="股票代號"
                value={trade.symbol}
                onChange={(value) =>
                  setTrade({
                    ...trade,
                    symbol: value.trim()
                  })
                }
              />
              <Field
                label="交易日期"
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
                  setTrade({
                    ...trade,
                    shares: Number(value)
                  })
                }
              />
              <Field
                label="成交價格"
                type="number"
                step="0.01"
                value={trade.price}
                onChange={(value) =>
                  setTrade({
                    ...trade,
                    price: Number(value)
                  })
                }
              />
            </div>

            <div className="costPreview">
              <Row
                label="成交金額"
                value={money(tradePreview.amount)}
              />
              <Row
                label={`手續費（${data.settings.brokerageDiscount} 折）`}
                value={money(tradePreview.fee)}
              />
              {trade.type === "sell" && (
                <Row
                  label="證券交易稅"
                  value={money(tradePreview.tax)}
                />
              )}
              <Row
                label={
                  trade.type === "buy"
                    ? "交割扣款"
                    : "賣出入帳"
                }
                value={money(tradePreview.settlementAmount)}
              />
              <Row
                label="含費用單位金額"
                value={
                  tradePreview.effectiveUnitCost
                    ? tradePreview.effectiveUnitCost.toFixed(4)
                    : "0"
                }
              />
            </div>
          </>
        ) : (
          <div className="tradeGrid">
            <Field
              label="金額"
              type="number"
              value={trade.cashAmount}
              onChange={(value) =>
                setTrade({
                  ...trade,
                  cashAmount: Number(value)
                })
              }
            />
            <Field
              label="日期"
              type="date"
              value={trade.date}
              onChange={(value) =>
                setTrade({ ...trade, date: value })
              }
            />
          </div>
        )}

        <label className="fullWidthField transactionNote">
          <span>備註</span>
          <input
            value={trade.note}
            placeholder="例如：每月薪資、定期定額、波段交易"
            onChange={(event) =>
              setTrade({
                ...trade,
                note: event.target.value
              })
            }
          />
        </label>

        <button className="tradeButton" onClick={submitTransaction}>
          {trade.type === "buy"
            ? "完成買進並扣除現金"
            : trade.type === "sell"
            ? "完成賣出並加回現金"
            : trade.type === "cash_in"
            ? "新增現金收入"
            : "新增現金支出"}
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
        <div className="sectionHeader">
          <div>
            <h2>交易與現金紀錄</h2>
            <small>輸入錯誤時可直接復原，系統會重算現金、庫存與均價。</small>
          </div>
        </div>

        {(data.transactions || []).length === 0 ? (
          <div className="empty smallEmpty">
            尚未新增交易。
          </div>
        ) : (
          <div className="transactionList">
            {(data.transactions || []).slice(0, 30).map(
              (transaction) => (
                <div
                  className="transactionItem"
                  key={transaction.id}
                >
                  <div>
                    <b>
                      {transaction.type === "buy"
                        ? "買進"
                        : transaction.type === "sell"
                        ? "賣出"
                        : transaction.type === "cash_in"
                        ? "現金收入"
                        : "現金支出"}
                      {transaction.symbol
                        ? `・${transaction.symbol}`
                        : ""}
                    </b>
                    <small>
                      {transaction.date}
                      {transaction.shares
                        ? `｜${Number(
                            transaction.shares
                          ).toLocaleString("zh-TW")} 股`
                        : ""}
                      {transaction.price
                        ? `｜成交價 ${Number(
                            transaction.price
                          ).toFixed(2)}`
                        : ""}
                    </small>
                    {transaction.note && (
                      <small>{transaction.note}</small>
                    )}
                  </div>

                  <div className="transactionRight">
                    <b
                      className={
                        Number(transaction.cashChange) >= 0
                          ? "up"
                          : "down"
                      }
                    >
                      {signedMoney(transaction.cashChange)}
                    </b>
                    {transaction.type === "sell" && (
                      <small
                        className={
                          Number(transaction.realizedPnl) >= 0
                            ? "up"
                            : "down"
                        }
                      >
                        已實現：
                        {signedMoney(transaction.realizedPnl)}
                      </small>
                    )}
                    <button
                      className="deleteText"
                      onClick={() =>
                        undoTransaction(transaction.id)
                      }
                    >
                      復原交易
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </section>

      <section className="card performanceCard">
        <h2>AI 績效與資金分析</h2>

        <div className="performanceGrid">
          <div>
            <span>累積已實現損益</span>
            <b className={realizedPnlTotal >= 0 ? "up" : "down"}>
              {signedMoney(realizedPnlTotal)}
            </b>
          </div>
          <div>
            <span>賣出交易勝率</span>
            <b>{winRate.toFixed(1)}%</b>
          </div>
          <div>
            <span>股票資金使用率</span>
            <b>{cashUsageRate.toFixed(1)}%</b>
          </div>
          <div>
            <span>目前可投資現金</span>
            <b>{money(investableCash)}</b>
          </div>
        </div>

        <div className="cashAdvice">
          <b>AI 資金提醒</b>
          <span>
            {projectedInvestableCash <= 0
              ? "目前可投資現金已接近零，新增部位前應先補足現金。"
              : cashUsageRate >= 80
              ? "股票部位已使用大部分資金，新增交易前請留意流動性。"
              : "目前仍保有可投資現金，交易前可先使用上方預估確認交易後餘額。"}
          </span>
        </div>
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
          label="保留現金（不投入股票）"
          type="number"
          value={data.settings.reserveCash}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                reserveCash: Number(value)
              }
            })
          }
        />

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
          label="財富目標金額"
          type="number"
          value={data.settings.wealthGoalAmount}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                wealthGoalAmount: Number(value)
              }
            })
          }
        />

        <Field
          label="財富目標日期"
          type="date"
          value={data.settings.wealthGoalDate}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                wealthGoalDate: value
              }
            })
          }
        />

        <Field
          label="每月預計投入"
          type="number"
          value={data.settings.monthlyContribution}
          onChange={(value) =>
            setData({
              ...data,
              settings: {
                ...data.settings,
                monthlyContribution: Number(value)
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
          label="正2平衡策略"
          description="開啟後，首頁才會顯示股票／可投資現金比例與建議調節金額"
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

        {strategy.leveragedEtf && (


        <div className="rebalanceSettings">
          <Field
            label="股票目標比例（%）"
            type="number"
            value={data.settings.rebalanceStockTarget}
            onChange={(value) => {
              const stock = Math.max(
                0,
                Math.min(100, Number(value))
              );
              setData({
                ...data,
                settings: {
                  ...data.settings,
                  rebalanceStockTarget: stock,
                  rebalanceCashTarget: 100 - stock
                }
              });
            }}
          />

          <Field
            label="可投資現金目標（%）"
            type="number"
            value={
              100 -
              Number(data.settings.rebalanceStockTarget || 0)
            }
            onChange={(value) => {
              const cash = Math.max(
                0,
                Math.min(100, Number(value))
              );
              setData({
                ...data,
                settings: {
                  ...data.settings,
                  rebalanceCashTarget: cash,
                  rebalanceStockTarget: 100 - cash
                }
              });
            }}
          />

          <Field
            label="容忍區間（±%）"
            type="number"
            step="0.5"
            value={data.settings.rebalanceTolerance}
            onChange={(value) =>
              setData({
                ...data,
                settings: {
                  ...data.settings,
                  rebalanceTolerance: Math.max(
                    0,
                    Number(value)
                  )
                }
              })
            }
          />

          <div className="rebalanceSettingsNote">
            只使用「股票市值＋可投資現金」計算。
            緊急預備金與黃金完全排除，不會被建議拿去加碼。
          </div>
        </div>
        )}

        <div className="strategySummary">
          <b>目前策略</b>
          <span>
            {strategy.leveragedEtf
              ? `正2平衡 ${data.settings.rebalanceStockTarget || 60}/${
                  100 - Number(data.settings.rebalanceStockTarget || 60)
                } 已開啟。`
              : "正2平衡策略暫停。"}
          </span>
        </div>
      </section>
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
