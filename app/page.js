"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULT_HOLDINGS = [
  { id: crypto.randomUUID(), symbol: "009816", shares: 0, averageCost: 0 }
];

const DEFAULT_SETTINGS = {
  cash: 150000,
  reserve: 250000,
  goldTael: 2.1,
  manualGoldTaelPrice: 0,
  taiexHigh: 0,
  goal: 3000000
};

const money = (value) =>
  new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

const signedMoney = (value) => {
  const number = Number(value) || 0;
  return `${number > 0 ? "+" : ""}${money(number)}`;
};

export default function Home() {
  const [holdings, setHoldings] = useState(DEFAULT_HOLDINGS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [market, setMarket] = useState({ stocks: [], taiex: {} });
  const [gold, setGold] = useState(null);
  const [goldBase, setGoldBase] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("準備完成");
  const [executedTier, setExecutedTier] = useState("");

  useEffect(() => {
    const savedHoldings = localStorage.getItem("jay31-holdings");
    const savedSettings = localStorage.getItem("jay31-settings");
    const savedSnapshots = localStorage.getItem("jay31-snapshots");
    const savedGoldBase = localStorage.getItem("jay31-gold-base");
    const savedExecuted = localStorage.getItem("jay31-executed-tier");

    if (savedHoldings) setHoldings(JSON.parse(savedHoldings));
    if (savedSettings) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
    if (savedSnapshots) setSnapshots(JSON.parse(savedSnapshots));
    if (savedGoldBase) setGoldBase(JSON.parse(savedGoldBase));
    if (savedExecuted) setExecutedTier(savedExecuted);
  }, []);

  useEffect(() => {
    if (!holdings.length) return;
    refreshAll();
    const timer = setInterval(refreshAll, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [holdings.map((item) => item.symbol).join(",")]);

  async function refreshAll() {
    setLoading(true);
    setStatus("正在更新股票、大盤與黃金…");

    const symbols = holdings
      .map((item) => item.symbol.trim())
      .filter(Boolean)
      .join(",");

    const [marketResult, goldResult] = await Promise.allSettled([
      fetch(`/api/market?symbols=${encodeURIComponent(symbols)}`, {
        cache: "no-store"
      }).then((response) => response.json()),
      fetch("/api/gold", { cache: "no-store" }).then((response) => response.json())
    ]);

    const messages = [];

    if (marketResult.status === "fulfilled" && marketResult.value.ok) {
      setMarket(marketResult.value);
      const currentIndex = marketResult.value.taiex?.price || 0;
      if (currentIndex) {
        setSettings((current) => {
          const next = {
            ...current,
            taiexHigh: Math.max(Number(current.taiexHigh) || 0, currentIndex)
          };
          localStorage.setItem("jay31-settings", JSON.stringify(next));
          return next;
        });
      }
      messages.push("股票與大盤成功");
    } else {
      messages.push(`股票或大盤失敗：${marketResult.value?.error || "未知錯誤"}`);
    }

    if (goldResult.status === "fulfilled" && goldResult.value.ok) {
      setGold(goldResult.value);
      updateGoldBase(goldResult.value.taelBuy);
      messages.push(`黃金成功（${goldResult.value.source}）`);
    } else {
      setGold(null);
      messages.push("黃金改用手動備援");
    }

    setStatus(`${messages.join("｜")}｜${new Date().toLocaleTimeString("zh-TW", {
      hour: "2-digit",
      minute: "2-digit"
    })}`);
    setLoading(false);
  }

  function updateGoldBase(price) {
    const today = new Date().toISOString().slice(0, 10);
    const saved = localStorage.getItem("jay31-gold-base");
    const base = saved ? JSON.parse(saved) : null;

    let next;
    if (!base) {
      next = { date: today, current: price, previous: price };
    } else if (base.date !== today) {
      next = { date: today, current: price, previous: base.current };
    } else {
      next = { ...base, current: price };
    }

    localStorage.setItem("jay31-gold-base", JSON.stringify(next));
    setGoldBase(next);
  }

  function saveHoldings(next) {
    setHoldings(next);
    localStorage.setItem("jay31-holdings", JSON.stringify(next));
  }

  function saveSettings(next) {
    setSettings(next);
    localStorage.setItem("jay31-settings", JSON.stringify(next));
  }

  const computed = useMemo(() => {
    const marketMap = Object.fromEntries(
      (market.stocks || []).map((item) => [item.symbol, item])
    );

    const rows = holdings.map((holding) => {
      const quote = marketMap[holding.symbol] || {};
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
        previousClose,
        marketValue,
        dailyPnl,
        totalPnl,
        returnPct:
          holding.averageCost > 0
            ? ((price / Number(holding.averageCost)) - 1) * 100
            : 0,
        quoteOk: quote.ok !== false
      };
    });

    const stockValue = rows.reduce((sum, item) => sum + item.marketValue, 0);
    const stockDaily = rows.reduce((sum, item) => sum + item.dailyPnl, 0);
    const stockTotal = rows.reduce((sum, item) => sum + item.totalPnl, 0);

    const automaticGold = gold?.taelBuy || 0;
    const goldTaelPrice =
      automaticGold || Number(settings.manualGoldTaelPrice) || 0;
    const goldPrevious = goldBase?.previous || goldTaelPrice;
    const goldValue = Number(settings.goldTael) * goldTaelPrice;
    const goldDaily = Number(settings.goldTael) * (goldTaelPrice - goldPrevious);

    const totalAsset =
      Number(settings.cash) +
      Number(settings.reserve) +
      stockValue +
      goldValue;

    const taiex = market.taiex?.price || 0;
    const high = Number(settings.taiexHigh) || taiex;
    const drawdown = high > 0 && taiex > 0
      ? ((taiex / high) - 1) * 100
      : 0;

    return {
      rows,
      stockValue,
      stockDaily,
      stockTotal,
      goldTaelPrice,
      goldValue,
      goldDaily,
      totalAsset,
      drawdown,
      dailyTotal: stockDaily + goldDaily
    };
  }, [holdings, settings, market, gold, goldBase]);

  useEffect(() => {
    if (!computed.totalAsset) return;
    const today = new Date().toISOString().slice(0, 10);
    const next = [
      ...snapshots.filter((item) => item.date !== today),
      {
        date: today,
        total: computed.totalAsset,
        stocks: computed.stockValue,
        gold: computed.goldValue,
        cash: Number(settings.cash),
        reserve: Number(settings.reserve)
      }
    ].slice(-365);

    setSnapshots(next);
    localStorage.setItem("jay31-snapshots", JSON.stringify(next));
  }, [computed.totalAsset]);

  const advice =
    computed.drawdown <= -30
      ? { tier: "-30%", title: "第三次加碼", amount: 150000, tone: "red" }
      : computed.drawdown <= -20
      ? { tier: "-20%", title: "第二次加碼", amount: 100000, tone: "orange" }
      : computed.drawdown <= -10
      ? { tier: "-10%", title: "第一次加碼", amount: 50000, tone: "green" }
      : {
          tier: "",
          title: "今天不用額外操作",
          amount: 0,
          tone: "blue"
        };

  function markExecuted() {
    if (!advice.tier) return;
    setExecutedTier(advice.tier);
    localStorage.setItem("jay31-executed-tier", advice.tier);
  }

  function resetExecuted() {
    setExecutedTier("");
    localStorage.removeItem("jay31-executed-tier");
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>Jay Invest</h1>
          <p>v3.1 核心資產版</p>
        </div>
        <button className="refresh" onClick={refreshAll} disabled={loading}>
          {loading ? "更新中" : "更新"}
        </button>
      </header>

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
                computed.totalAsset / Number(settings.goal) * 100
              )}%`
            }}
          />
        </div>
        <small>
          {money(settings.goal)} 目標：
          {(computed.totalAsset / Number(settings.goal) * 100).toFixed(1)}%
        </small>
      </section>

      <section className="two">
        <Metric
          label="股票今日損益"
          value={signedMoney(computed.stockDaily)}
          tone={computed.stockDaily}
          note={`${holdings.length} 檔持股`}
        />
        <Metric
          label="黃金今日損益"
          value={signedMoney(computed.goldDaily)}
          tone={computed.goldDaily}
          note={`${settings.goldTael} 兩`}
        />
      </section>

      <section className={`card advice ${advice.tone}`}>
        <div>
          <span>大盤距離追蹤高點</span>
          <strong>{computed.drawdown.toFixed(1)}%</strong>
        </div>
        <div className="adviceText">
          <b>
            {executedTier === advice.tier && advice.tier
              ? `${advice.title}已執行`
              : advice.title}
          </b>
          <span>
            {advice.amount ? money(advice.amount) : "照計畫定期定額"}
          </span>
          {advice.tier && executedTier !== advice.tier && (
            <button onClick={markExecuted}>標記已執行</button>
          )}
          {executedTier && (
            <button className="ghost" onClick={resetExecuted}>
              重設提醒
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
        <Row label="現金" value={money(settings.cash)} />
        <Row label="預備金" value={money(settings.reserve)} />
      </section>

      <section className="card">
        <div className="sectionHeader">
          <h2>持股管理</h2>
          <button
            className="smallButton"
            onClick={() =>
              saveHoldings([
                ...holdings,
                {
                  id: crypto.randomUUID(),
                  symbol: "",
                  shares: 0,
                  averageCost: 0
                }
              ])
            }
          >
            新增
          </button>
        </div>

        {computed.rows.map((holding, index) => (
          <article className="holding" key={holding.id}>
            <div className="holdingTop">
              <div>
                <b>{holding.name || "新持股"}</b>
                <small>{holding.symbol || "尚未填寫代號"}</small>
              </div>
              <button
                className="delete"
                onClick={() =>
                  saveHoldings(holdings.filter((item) => item.id !== holding.id))
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
                    const next = [...holdings];
                    next[index] = {
                      ...next[index],
                      symbol: event.target.value.trim()
                    };
                    saveHoldings(next);
                  }}
                />
              </label>
              <label>
                股數
                <input
                  type="number"
                  value={holding.shares}
                  onChange={(event) => {
                    const next = [...holdings];
                    next[index] = {
                      ...next[index],
                      shares: Number(event.target.value)
                    };
                    saveHoldings(next);
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
                    const next = [...holdings];
                    next[index] = {
                      ...next[index],
                      averageCost: Number(event.target.value)
                    };
                    saveHoldings(next);
                  }}
                />
              </label>
              <div className="quoteBox">
                <span>現價</span>
                <b>{holding.price ? holding.price.toFixed(2) : "--"}</b>
              </div>
            </div>

            <div className="holdingStats">
              <Row label="市值" value={money(holding.marketValue)} />
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
        <h2>資產成長</h2>
        <MiniChart data={snapshots} />
        <small>每日開啟網站時自動保留一筆，最多保存 365 天。</small>
      </section>

      <details className="card settings">
        <summary>其他設定</summary>
        <Field
          label="現金"
          type="number"
          value={settings.cash}
          onChange={(value) =>
            saveSettings({ ...settings, cash: Number(value) })
          }
        />
        <Field
          label="預備金"
          type="number"
          value={settings.reserve}
          onChange={(value) =>
            saveSettings({ ...settings, reserve: Number(value) })
          }
        />
        <Field
          label="黃金持有（兩）"
          type="number"
          step="0.1"
          value={settings.goldTael}
          onChange={(value) =>
            saveSettings({ ...settings, goldTael: Number(value) })
          }
        />
        <Field
          label="黃金手動備援價（每兩）"
          type="number"
          value={settings.manualGoldTaelPrice}
          onChange={(value) =>
            saveSettings({
              ...settings,
              manualGoldTaelPrice: Number(value)
            })
          }
        />
        <Field
          label="加權指數參考高點"
          type="number"
          value={settings.taiexHigh}
          onChange={(value) =>
            saveSettings({ ...settings, taiexHigh: Number(value) })
          }
        />
        <Field
          label="資產目標"
          type="number"
          value={settings.goal}
          onChange={(value) =>
            saveSettings({ ...settings, goal: Number(value) })
          }
        />
        <p className="hint">
          黃金自動來源失效時，系統會直接使用手動備援價，不再讓整個資產頁面報錯。
        </p>
      </details>

      <section className="card plan">
        <h2>009816 定期定額</h2>
        <div>7 日　NT$4,000</div>
        <div>14 日　NT$4,000</div>
        <div>21 日　NT$4,000</div>
        <div>28 日　NT$4,000</div>
        <small>每月合計 NT$16,000，其餘資金保留現金。</small>
      </section>

      <footer>{status}</footer>
    </main>
  );
}

function Metric({ label, value, tone, note }) {
  return (
    <article className="card metric">
      <span>{label}</span>
      <strong className={tone >= 0 ? "up" : "down"}>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="row">
      <span>{label}</span>
      <b className={tone === undefined ? "" : tone >= 0 ? "up" : "down"}>
        {value}
      </b>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", step }) {
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
    return <div className="empty">累積兩天資料後顯示資產曲線。</div>;
  }

  const values = data.map((item) => item.total);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = data
    .map((item, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 92 - ((item.total - min) / Math.max(1, max - min)) * 84;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="chart">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
    </svg>
  );
}
