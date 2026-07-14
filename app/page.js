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
      averageCost: 0,
      positionType: "cash",
      openedAt: ""
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
    balanceSymbol: "00631L",
    wealthGoalAmount: 2000000,
    wealthGoalDate: "2027-07-18",
    monthlyContribution: 30000,
    financingRatio: 60,
    financingAnnualRate: 6.5,
    shortMarginRatio: 90,
    shortBorrowAnnualRate: 6.5,
    maintenanceWarning: 160,
    maintenanceCall: 130
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
    type: "cash_buy",
    symbol: "",
    shares: 0,
    price: 0,
    date: new Date().toISOString().slice(0, 10),
    cashAmount: 0,
    financingRatio: 60,
    financingAnnualRate: 6.5,
    shortMarginRatio: 90,
    shortBorrowAnnualRate: 6.5,
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
      const price = Number(quote.price) || Number(holding.averageCost) || 0;
      const previousClose = Number(quote.previousClose) || price;
      const shares = Number(holding.shares) || 0;
      const averageCost = Number(holding.averageCost) || 0;
      const positionType = holding.positionType || "cash";
      const marketValue = shares * price;
      const openedAt = holding.openedAt
        ? new Date(`${holding.openedAt}T00:00:00`)
        : new Date();
      const holdingDays = Math.max(
        0,
        Math.ceil((Date.now() - openedAt.getTime()) / 86400000)
      );
      const financingPrincipal = Number(holding.financingPrincipal) || 0;
      const financingAnnualRate =
        Number(holding.financingAnnualRate) ||
        Number(data.settings.financingAnnualRate) ||
        0;
      const accruedInterest =
        positionType === "margin"
          ? financingPrincipal * (financingAnnualRate / 100) *
            (holdingDays / 365)
          : 0;
      const shortSaleProceeds = Number(holding.shortSaleProceeds) || 0;
      const shortMarginDeposit = Number(holding.shortMarginDeposit) || 0;
      const shortBorrowAnnualRate =
        Number(holding.shortBorrowAnnualRate) ||
        Number(data.settings.shortBorrowAnnualRate) ||
        0;
      const accruedBorrowFee =
        positionType === "short"
          ? shortSaleProceeds * (shortBorrowAnnualRate / 100) *
            (holdingDays / 365)
          : 0;
      const dailyPnl =
        positionType === "short"
          ? shares * (previousClose - price)
          : shares * (price - previousClose);
      const totalPnl =
        positionType === "short"
          ? shares * (averageCost - price) - accruedBorrowFee
          : shares * (price - averageCost) - accruedInterest;
      const netEquity =
        positionType === "margin"
          ? marketValue - financingPrincipal - accruedInterest
          : positionType === "short"
          ? shortSaleProceeds + shortMarginDeposit - marketValue - accruedBorrowFee
          : marketValue;
      const maintenanceRate =
        positionType === "margin" && financingPrincipal > 0
          ? (marketValue / financingPrincipal) * 100
          : positionType === "short" && marketValue > 0
          ? ((shortSaleProceeds + shortMarginDeposit) / marketValue) * 100
          : null;

      return {
        ...holding,
        positionType,
        name: quote.name || holding.symbol,
        price,
        marketValue,
        netEquity,
        dailyPnl,
        totalPnl,
        holdingDays,
        accruedInterest,
        accruedBorrowFee,
        maintenanceRate,
        returnPct:
          averageCost > 0
            ? positionType === "short"
              ? ((averageCost / price) - 1) * 100
              : ((price / averageCost) - 1) * 100
            : 0
      };
    });

    const grossStockValue = holdings.reduce(
      (sum, holding) => sum + holding.marketValue,
      0
    );
    const stockValue = holdings.reduce(
      (sum, holding) => sum + holding.netEquity,
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
    const leveragedHoldings = holdings.filter(
      (holding) => ["margin", "short"].includes(holding.positionType)
    );
    const lowestMaintenance = leveragedHoldings
      .filter((holding) => Number.isFinite(holding.maintenanceRate))
      .sort((a, b) => a.maintenanceRate - b.maintenanceRate)[0] || null;

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
      grossStockValue,
      leveragedHoldings,
      lowestMaintenance,
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
    const shares = Math.floor(Number(trade.shares) || 0);
    const price = Number(trade.price) || 0;
    const amount = shares * price;
    const discount =
      Math.max(0, Number(data.settings.brokerageDiscount) || 0) / 10;
    const calculatedFee = amount * 0.001425 * discount;
    const fee = amount > 0
      ? Math.max(Number(data.settings.minimumFee) || 0, Math.round(calculatedFee))
      : 0;
    const isSale = ["cash_sell", "margin_sell", "short_sell"].includes(trade.type);
    const tax = isSale ? Math.round(amount * 0.003) : 0;
    const financingRatio = Math.max(0, Math.min(100,
      Number(trade.financingRatio) || Number(data.settings.financingRatio) || 0));
    const financingPrincipal = amount * (financingRatio / 100);
    const selfFunding = amount - financingPrincipal;
    const shortMarginRatio = Math.max(0,
      Number(trade.shortMarginRatio) || Number(data.settings.shortMarginRatio) || 0);
    const shortMarginDeposit = amount * (shortMarginRatio / 100);
    let cashChange = 0;
    if (trade.type === "cash_buy") cashChange = -(amount + fee);
    if (trade.type === "cash_sell") cashChange = amount - fee - tax;
    if (trade.type === "margin_buy") cashChange = -(selfFunding + fee);
    if (trade.type === "short_sell") cashChange = -(shortMarginDeposit + fee + tax);
    if (trade.type === "cash_in") cashChange = Number(trade.cashAmount) || 0;
    if (trade.type === "cash_out") cashChange = -(Number(trade.cashAmount) || 0);

    return {
      amount, fee, tax, financingRatio, financingPrincipal, selfFunding,
      shortMarginRatio, shortMarginDeposit, cashChange,
      settlementAmount: Math.abs(cashChange),
      effectiveUnitCost: shares > 0 ? (amount + fee + tax) / shares : 0
    };
  }, [trade, data.settings]);

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

  function positionTypeForTrade(type) {
    if (type.startsWith("margin_")) return "margin";
    if (type.startsWith("short_")) return "short";
    return "cash";
  }

  function submitTransaction() {
    const type = trade.type;
    const now = new Date().toISOString();
    const currentCash = Number(data.settings.investmentCash) || 0;

    if (["cash_in", "cash_out"].includes(type)) {
      const amount = Number(trade.cashAmount) || 0;
      if (amount <= 0) return setTradeMessage("請輸入現金金額。");
      if (type === "cash_out" && amount > currentCash)
        return setTradeMessage("可投資現金不足，無法登錄支出。");
      const cashChange = type === "cash_in" ? amount : -amount;
      const transaction = {
        id: crypto.randomUUID(), type, date: trade.date, cashChange,
        note: trade.note || (type === "cash_in" ? "現金收入" : "現金支出"),
        createdAt: now, holdingsBefore: data.holdings
      };
      setData({
        ...data,
        settings: {...data.settings, investmentCash: currentCash + cashChange},
        transactions: [transaction, ...(data.transactions || [])],
        cashLedger: [{
          id: crypto.randomUUID(), transactionId: transaction.id, type,
          amount: cashChange, balanceAfter: currentCash + cashChange,
          note: transaction.note, date: trade.date, createdAt: now
        }, ...(data.cashLedger || [])]
      });
      setTradeMessage("現金餘額已更新。");
      setTrade({...trade, cashAmount: 0, note: ""});
      return;
    }

    const symbol = trade.symbol.trim().toUpperCase();
    const shares = Math.floor(Number(trade.shares) || 0);
    const price = Number(trade.price) || 0;
    if (!symbol || shares <= 0 || price <= 0)
      return setTradeMessage("請輸入股票代號、股數與成交價格。");

    const positionType = positionTypeForTrade(type);
    const isOpening = ["cash_buy", "margin_buy", "short_sell"].includes(type);
    const isClosing = ["cash_sell", "margin_sell", "short_cover"].includes(type);
    const existingHolding = (data.holdings || []).find(
      h => h.symbol === symbol && (h.positionType || "cash") === positionType
    );
    if (isClosing && (!existingHolding || Number(existingHolding.shares) < shares))
      return setTradeMessage("平倉股數超過該交易方式的目前庫存。");

    let cashChange = tradePreview.cashChange;
    let realizedPnl = 0;
    let nextHoldings = [...(data.holdings || [])];

    if (type === "margin_sell") {
      const ratio = shares / Number(existingHolding.shares);
      const principal = Number(existingHolding.financingPrincipal || 0) * ratio;
      const days = Math.max(0, Math.ceil((Date.now() - new Date(`${existingHolding.openedAt || trade.date}T00:00:00`).getTime()) / 86400000));
      const interest = principal * ((Number(existingHolding.financingAnnualRate) || Number(data.settings.financingAnnualRate) || 0) / 100) * (days / 365);
      cashChange = tradePreview.amount - tradePreview.fee - tradePreview.tax - principal - interest;
      realizedPnl = cashChange - shares * Number(existingHolding.selfFundingPerShare || 0);
    }
    if (type === "short_cover") {
      const ratio = shares / Number(existingHolding.shares);
      const proceeds = Number(existingHolding.shortSaleProceeds || 0) * ratio;
      const deposit = Number(existingHolding.shortMarginDeposit || 0) * ratio;
      const days = Math.max(0, Math.ceil((Date.now() - new Date(`${existingHolding.openedAt || trade.date}T00:00:00`).getTime()) / 86400000));
      const borrowFee = proceeds * ((Number(existingHolding.shortBorrowAnnualRate) || Number(data.settings.shortBorrowAnnualRate) || 0) / 100) * (days / 365);
      cashChange = deposit + proceeds - tradePreview.amount - tradePreview.fee - borrowFee;
      realizedPnl = proceeds - tradePreview.amount - tradePreview.fee - tradePreview.tax - borrowFee;
    }
    if (currentCash + cashChange < 0)
      return setTradeMessage("可投資現金不足，無法完成這筆交易。");

    if (isOpening) {
      const previousShares = Number(existingHolding?.shares) || 0;
      const newShares = previousShares + shares;
      const previousCost = previousShares * Number(existingHolding?.averageCost || 0);
      const newAverageCost = (previousCost + tradePreview.amount + tradePreview.fee + tradePreview.tax) / newShares;
      const base = {
        ...(existingHolding || {}),
        id: existingHolding?.id || crypto.randomUUID(), symbol, positionType,
        shares: newShares, averageCost: Number(newAverageCost.toFixed(6)),
        openedAt: existingHolding?.openedAt || trade.date
      };
      if (type === "margin_buy") {
        base.financingRatio = tradePreview.financingRatio;
        base.financingPrincipal = Number(existingHolding?.financingPrincipal || 0) + tradePreview.financingPrincipal;
        base.financingAnnualRate = Number(trade.financingAnnualRate) || Number(data.settings.financingAnnualRate);
        base.selfFundingPerShare = ((Number(existingHolding?.selfFundingPerShare || 0) * previousShares) + tradePreview.selfFunding + tradePreview.fee) / newShares;
      }
      if (type === "short_sell") {
        base.shortMarginRatio = tradePreview.shortMarginRatio;
        base.shortSaleProceeds = Number(existingHolding?.shortSaleProceeds || 0) + tradePreview.amount;
        base.shortMarginDeposit = Number(existingHolding?.shortMarginDeposit || 0) + tradePreview.shortMarginDeposit;
        base.shortBorrowAnnualRate = Number(trade.shortBorrowAnnualRate) || Number(data.settings.shortBorrowAnnualRate);
      }
      nextHoldings = existingHolding
        ? nextHoldings.map(h => h.id === existingHolding.id ? base : h)
        : [...nextHoldings, base];
    } else {
      const remaining = Number(existingHolding.shares) - shares;
      if (remaining <= 0) nextHoldings = nextHoldings.filter(h => h.id !== existingHolding.id);
      else {
        const factor = remaining / Number(existingHolding.shares);
        nextHoldings = nextHoldings.map(h => h.id !== existingHolding.id ? h : {
          ...h, shares: remaining,
          financingPrincipal: Number(h.financingPrincipal || 0) * factor,
          shortSaleProceeds: Number(h.shortSaleProceeds || 0) * factor,
          shortMarginDeposit: Number(h.shortMarginDeposit || 0) * factor
        });
      }
      if (type === "cash_sell")
        realizedPnl = cashChange - shares * Number(existingHolding.averageCost || 0);
    }

    const transaction = {
      id: crypto.randomUUID(), type, positionType, symbol, shares, price,
      amount: tradePreview.amount, fee: tradePreview.fee, tax: tradePreview.tax,
      cashChange, realizedPnl, date: trade.date, note: trade.note,
      holdingsBefore: data.holdings, createdAt: now
    };
    const nextCash = currentCash + cashChange;
    setData({
      ...data,
      settings: {...data.settings, investmentCash: nextCash},
      holdings: nextHoldings,
      transactions: [transaction, ...(data.transactions || [])],
      cashLedger: [{
        id: crypto.randomUUID(), transactionId: transaction.id, type, symbol,
        amount: cashChange, balanceAfter: nextCash,
        note: trade.note || `${type} ${symbol}`, date: trade.date, createdAt: now
      }, ...(data.cashLedger || [])]
    });
    setTradeMessage(`交易完成：${symbol} ${shares.toLocaleString("zh-TW")} 股。`);
    setTrade({...trade, symbol: "", shares: 0, price: 0, note: ""});
  }

  function undoTransaction(transactionId) {
    const transaction = (data.transactions || []).find(item => item.id === transactionId);
    if (!transaction) return;
    const revertedCash = Number(data.settings.investmentCash || 0) - Number(transaction.cashChange || 0);
    setData({
      ...data,
      settings: {...data.settings, investmentCash: revertedCash},
      holdings: Array.isArray(transaction.holdingsBefore) ? transaction.holdingsBefore : data.holdings,
      transactions: (data.transactions || []).filter(item => item.id !== transactionId),
      cashLedger: [{
        id: crypto.randomUUID(), transactionId, type: "undo",
        amount: -Number(transaction.cashChange || 0), balanceAfter: revertedCash,
        note: `復原交易：${transaction.symbol || transaction.note || transaction.type}`,
        date: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString()
      }, ...(data.cashLedger || [])]
    });
    setTradeMessage("交易已復原，持股與現金已回到交易前狀態。");
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


  const selectedBalanceHolding = (data.holdings || []).find(
    (holding) =>
      String(holding.symbol || "").trim().toUpperCase() ===
      String(
        data.settings.balanceSymbol ||
          data.settings.leveragedEtfSymbol ||
          ""
      )
        .trim()
        .toUpperCase()
  );

  const selectedBalanceQuote = selectedBalanceHolding
    ? (market.stocks || []).find(
        (item) =>
          String(item.symbol || "").trim().toUpperCase() ===
          String(selectedBalanceHolding.symbol || "")
            .trim()
            .toUpperCase()
      )
    : null;

  const selectedBalancePrice =
    Number(selectedBalanceQuote?.price) ||
    Number(selectedBalanceHolding?.averageCost) ||
    0;

  const selectedBalanceValue =
    (Number(selectedBalanceHolding?.shares) || 0) *
    selectedBalancePrice;

  const rebalanceInvestableTotal =
    selectedBalanceValue + investableCash;

  const currentStockRatio =
    rebalanceInvestableTotal > 0
      ? (selectedBalanceValue / rebalanceInvestableTotal) * 100
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
    selectedBalanceValue - targetStockValue;

  const needsRebalance =
    strategy.leveragedEtf &&
    rebalanceInvestableTotal > 0 &&
    Math.abs(currentStockRatio - stockTarget) >
      rebalanceTolerance;

  const rebalanceDirection =
    rebalanceAmount > 0 ? "reduce_stock" : "increase_stock";

  const balanceSymbol = String(
    data.settings.balanceSymbol ||
      data.settings.balanceSymbol ||
      ""
  )
    .trim()
    .toUpperCase();

  const balanceHolding = (data.holdings || []).find(
    (holding) =>
      String(holding.symbol || "").trim().toUpperCase() ===
        balanceSymbol &&
      Number(holding.shares) > 0
  );

  const balanceStrategyActive =
    strategy.leveragedEtf && Boolean(balanceHolding);

  const effectiveNeedsRebalance =
    balanceStrategyActive && needsRebalance;

  const drawdownActionRequired =
    Boolean(advice.tier) &&
    Number(advice.amount) > 0 &&
    data.executedTier !== advice.tier;

  const marginRiskAction = Boolean(
    computed.lowestMaintenance &&
    computed.lowestMaintenance.maintenanceRate <=
      Number(data.settings.maintenanceWarning || 160)
  );

  const todayNeedsAction =
    drawdownActionRequired || effectiveNeedsRebalance || marginRiskAction;

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
      ? "平衡策略已偏離容忍區間，建議查看調節金額。"
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
        ? "平衡策略已超出容忍區間"
        : "平衡策略仍在容忍區間"
      : "平衡策略未啟用",
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
          : "平衡策略目前未啟用，因此不產生調節建議。"
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
  const currentTotalAsset = Number(computed.totalAsset) || 0;

  const wealthGoalProgress =
    wealthGoalAmount > 0
      ? Math.min(100, (currentTotalAsset / wealthGoalAmount) * 100)
      : 0;
  const wealthGoalGap = Math.max(
    0,
    wealthGoalAmount - currentTotalAsset
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
          <p>V7.5 Margin & Short Engine</p>
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
          todayNeedsAction ? "yellow" : "green"
        }`}
      >
        <span className="eyebrow">今天需要變動？</span>

        <div className="simpleV6Answer">
          <span
            className={`decisionDot ${
              todayNeedsAction ? "yellow" : "green"
            }`}
          />
          <strong>{todayNeedsAction ? "需要" : "不需要"}</strong>
        </div>

        {drawdownActionRequired && (
          <div className="simpleMarketAction">
            <span>大盤回檔策略</span>
            <b>
              已達 {advice.tier}，建議評估投入 {money(advice.amount)}
            </b>
          </div>
        )}

        {strategy.leveragedEtf && (
          <div className="simpleRebalanceBox">
            {!balanceHolding ? (
              <div className="fullRebalanceRow">
                <span>平衡策略</span>
                <b>未持有 {balanceSymbol}，策略不啟動</b>
              </div>
            ) : (
              <>
                <div>
                  <span>平衡策略</span>
                  <b>
                    {effectiveNeedsRebalance
                      ? "需要調整"
                      : "不用調整"}
                  </b>
                </div>

                {effectiveNeedsRebalance && (
                  <div>
                    <span>建議調整金額</span>
                    <b>{money(Math.abs(rebalanceAmount))}</b>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {computed.lowestMaintenance && (
          <div className={`marginRiskBanner ${
            computed.lowestMaintenance.maintenanceRate <= Number(data.settings.maintenanceCall || 130)
              ? "danger"
              : computed.lowestMaintenance.maintenanceRate <= Number(data.settings.maintenanceWarning || 160)
              ? "warning"
              : "safe"
          }`}>
            <span>最低維持率</span>
            <b>
              {computed.lowestMaintenance.symbol}・
              {computed.lowestMaintenance.maintenanceRate.toFixed(1)}%
            </b>
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
            <b>{money(currentTotalAsset)}</b>
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
            ["cash_buy", "現股買進"],
            ["cash_sell", "現股賣出"],
            ["margin_buy", "融資買進"],
            ["margin_sell", "融資賣出"],
            ["short_sell", "融券賣出"],
            ["short_cover", "融券回補"],
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

        {! ["cash_in", "cash_out"].includes(trade.type) ? (
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

            {trade.type.startsWith("margin_") && (
              <div className="tradeGrid leverageFields">
                <Field label="融資成數（%）" type="number" value={trade.financingRatio}
                  onChange={(value) => setTrade({...trade, financingRatio: Number(value)})} />
                <Field label="融資年利率（%）" type="number" step="0.01" value={trade.financingAnnualRate}
                  onChange={(value) => setTrade({...trade, financingAnnualRate: Number(value)})} />
              </div>
            )}

            {trade.type.startsWith("short_") && (
              <div className="tradeGrid leverageFields">
                <Field label="融券保證金成數（%）" type="number" value={trade.shortMarginRatio}
                  onChange={(value) => setTrade({...trade, shortMarginRatio: Number(value)})} />
                <Field label="融券年費率（%）" type="number" step="0.01" value={trade.shortBorrowAnnualRate}
                  onChange={(value) => setTrade({...trade, shortBorrowAnnualRate: Number(value)})} />
              </div>
            )}

            <div className="costPreview">
              <Row
                label="成交金額"
                value={money(tradePreview.amount)}
              />
              <Row
                label={`手續費（${data.settings.brokerageDiscount} 折）`}
                value={money(tradePreview.fee)}
              />
              {["cash_sell", "margin_sell", "short_sell"].includes(trade.type) && (
                <Row label="證券交易稅" value={money(tradePreview.tax)} />
              )}
              {trade.type === "margin_buy" && (
                <>
                  <Row label="融資本金" value={money(tradePreview.financingPrincipal)} />
                  <Row label="自備款" value={money(tradePreview.selfFunding)} />
                </>
              )}
              {trade.type === "short_sell" && (
                <Row label="融券保證金" value={money(tradePreview.shortMarginDeposit)} />
              )}
              <Row
                label={
                  ["cash_buy", "margin_buy", "short_sell"].includes(trade.type)
                    ? "預估扣款"
                    : "預估入帳"
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
          完成交易並更新現金與持股
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
                    averageCost: 0,
                    positionType: "cash",
                    openedAt: ""
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
                  {holding.symbol || "尚未填寫代號"}・
                  {holding.positionType === "margin"
                    ? "融資"
                    : holding.positionType === "short"
                    ? "融券"
                    : "現股"}
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
                交易方式
                <select
                  value={holding.positionType || "cash"}
                  onChange={(event) => {
                    const next = [...data.holdings];
                    next[index] = {...next[index], positionType: event.target.value};
                    setData({...data, holdings: next});
                  }}
                >
                  <option value="cash">現股</option>
                  <option value="margin">融資</option>
                  <option value="short">融券</option>
                </select>
              </label>

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
                      {{
                        cash_buy: "現股買進", cash_sell: "現股賣出",
                        margin_buy: "融資買進", margin_sell: "融資賣出",
                        short_sell: "融券賣出", short_cover: "融券回補",
                        cash_in: "現金收入", cash_out: "現金支出"
                      }[transaction.type] || transaction.type}
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
                    {["cash_sell", "margin_sell", "short_cover"].includes(transaction.type) && (
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
          例如券商 2.8 折請填 2.8；最低手續費依你的實際方案設定。
        </p>

        <Field label="預設融資成數（%）" type="number" value={data.settings.financingRatio}
          onChange={(value) => setData({...data, settings:{...data.settings, financingRatio:Number(value)}})} />
        <Field label="預設融資年利率（%）" type="number" step="0.01" value={data.settings.financingAnnualRate}
          onChange={(value) => setData({...data, settings:{...data.settings, financingAnnualRate:Number(value)}})} />
        <Field label="預設融券保證金成數（%）" type="number" value={data.settings.shortMarginRatio}
          onChange={(value) => setData({...data, settings:{...data.settings, shortMarginRatio:Number(value)}})} />
        <Field label="預設融券年費率（%）" type="number" step="0.01" value={data.settings.shortBorrowAnnualRate}
          onChange={(value) => setData({...data, settings:{...data.settings, shortBorrowAnnualRate:Number(value)}})} />
        <Field label="維持率注意門檻（%）" type="number" value={data.settings.maintenanceWarning}
          onChange={(value) => setData({...data, settings:{...data.settings, maintenanceWarning:Number(value)}})} />
        <Field label="維持率高風險門檻（%）" type="number" value={data.settings.maintenanceCall}
          onChange={(value) => setData({...data, settings:{...data.settings, maintenanceCall:Number(value)}})} />
        <p className="hint">維持率與追繳風險為估算值；實際規則、費率與處分條件以券商通知為準。</p>

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
          label="平衡策略"
          description="開啟後，可從目前持股中選擇一檔標的，並依標的市值／可投資現金比例給出調節建議"
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
          <label className="fullWidthField">
            <span>套用平衡的持股</span>
            <select
              value={
                data.settings.balanceSymbol ||
                data.settings.leveragedEtfSymbol ||
                ""
              }
              onChange={(event) =>
                setData({
                  ...data,
                  settings: {
                    ...data.settings,
                    balanceSymbol: event.target.value
                  }
                })
              }
            >
              <option value="">請選擇持股</option>
              {(data.holdings || [])
                .filter((holding) => Number(holding.shares) > 0)
                .map((holding) => (
                  <option
                    key={holding.id || holding.symbol}
                    value={String(holding.symbol || "")
                      .trim()
                      .toUpperCase()}
                  >
                    {String(holding.symbol || "")
                      .trim()
                      .toUpperCase()}
                    {" ・ "}
                    {Number(holding.shares).toLocaleString("zh-TW")} 股
                  </option>
                ))}
            </select>
          </label>
          <Field
            label="指定持股目標比例（%）"
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
            只使用「指定持股市值＋可投資現金」計算。
            緊急預備金與黃金完全排除，不會被建議拿去加碼。
          </div>
        </div>
        )}

        <div className="strategySummary">
          <b>目前策略</b>
          <span>
            {strategy.leveragedEtf
              ? `平衡策略 ${data.settings.rebalanceStockTarget || 60}/${
                  100 - Number(data.settings.rebalanceStockTarget || 60)
                } 已開啟。`
              : "平衡策略暫停。"}
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
