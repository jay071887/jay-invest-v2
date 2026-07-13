import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parseNumber(value) {
  const number = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function findTaelPrice(text) {
  const compact = text.replace(/\s+/g, " ");

  const patterns = [
    /(?:1\s*台兩|一\s*台兩)[\s\S]{0,1000}?(?:本行買進|買進)[\s\S]{0,300}?([\d,]{5,})/i,
    /(?:黃金條塊|金鑽條塊|幻彩條塊)[\s\S]{0,2000}?(?:本行買進|買進)[\s\S]{0,350}?([\d,]{5,})/i,
    /(?:1\s*Tael)[\s\S]{0,1000}?(?:Buying|Buy)[\s\S]{0,300}?([\d,]{5,})/i
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (!match) continue;
    const value = parseNumber(match[1]);
    if (value >= 50000 && value <= 1000000) return value;
  }

  return 0;
}

async function fetchText(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html, text/plain, */*"
    }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function GET() {
  const sources = [
    {
      name: "臺灣銀行黃金牌價",
      url: "https://rate.bot.com.tw/gold/quote/recent?Lang=zh-TW"
    },
    {
      name: "臺灣銀行文字備援",
      url: "https://r.jina.ai/http://rate.bot.com.tw/gold/quote/recent?Lang=zh-TW"
    }
  ];

  const errors = [];

  for (const source of sources) {
    try {
      const text = await fetchText(source.url);
      const taelBuy = findTaelPrice(text);

      if (!taelBuy) throw new Error("找不到一台兩買進價");

      return NextResponse.json({
        ok: true,
        source: source.name,
        taelBuy,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      errors.push(`${source.name}: ${error.message}`);
    }
  }

  return NextResponse.json({
    ok: false,
    error: "自動金價暫時無法取得",
    details: errors
  });
}
