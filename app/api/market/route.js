import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function toNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(number) ? number : 0;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbols = (searchParams.get("symbols") || "009816")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);

  const channels = [
    ...symbols.flatMap((symbol) => [
      `tse_${symbol}.tw`,
      `otc_${symbol}.tw`
    ]),
    "tse_t00.tw"
  ].join("|");

  const url =
    "https://mis.twse.com.tw/stock/api/getStockInfo.jsp" +
    `?ex_ch=${encodeURIComponent(channels)}&json=1&delay=0`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://mis.twse.com.tw/stock/index.jsp"
      }
    });

    if (!response.ok) throw new Error(`TWSE HTTP ${response.status}`);

    const data = await response.json();
    const rows = Array.isArray(data.msgArray) ? data.msgArray : [];

    const stocks = symbols.map((symbol) => {
      const row = rows.find((item) => item.c === symbol);

      if (!row) {
        return { symbol, ok: false, error: "找不到行情" };
      }

      const price = toNumber(row.z) || toNumber(row.y);
      const previousClose = toNumber(row.y);

      return {
        symbol,
        ok: true,
        name: row.n || symbol,
        price,
        previousClose,
        change: price - previousClose,
        changePercent: previousClose
          ? ((price / previousClose) - 1) * 100
          : 0
      };
    });

    const index = rows.find(
      (row) => row.ch === "t00.tw" || row.c === "t00"
    );

    const indexPrice = index ? (toNumber(index.z) || toNumber(index.y)) : 0;
    const indexPrevious = index ? toNumber(index.y) : 0;

    return NextResponse.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      stocks,
      taiex: {
        price: indexPrice,
        previousClose: indexPrevious,
        change: indexPrice - indexPrevious,
        changePercent: indexPrevious
          ? ((indexPrice / indexPrevious) - 1) * 100
          : 0
      }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "無法取得台股資料" },
      { status: 502 }
    );
  }
}
