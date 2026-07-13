"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

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
    goal: 3000000
  },
  snapshots: [],
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
        }
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
        strategies: cloneDefaultData().strategies
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
          <p>v3.2 雲端同步版</p>
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
        <h2>資產成長</h2>
        <MiniChart data={data.snapshots || []} />
        <small>
          資產快照已改存 Supabase，手機與電腦共用。
        </small>
      </section>

      <details className="card settings">
        <summary>其他設定</summary>

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
