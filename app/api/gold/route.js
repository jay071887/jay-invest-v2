import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
const clean=v=>{const n=Number(String(v??'').replace(/[^\d.]/g,''));return Number.isFinite(n)?n:0};
export async function GET(){
 const url='https://rate.bot.com.tw/gold/quote/recent?Lang=zh-TW';
 try{
  const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':'Mozilla/5.0'}});if(!r.ok)throw new Error('BOT HTTP '+r.status);
  const html=(await r.text()).replace(/\s+/g,' ');
  const pats=[/黃金條塊[\s\S]{0,2500}?1\s*台兩[\s\S]{0,1200}?本行買進[\s\S]{0,300}?([\d,]{5,})/i,/Gold Holobar[\s\S]{0,2500}?1\s*Tael[\s\S]{0,1200}?Buying[\s\S]{0,300}?([\d,]{5,})/i,/1\s*台兩[\s\S]{0,700}?買進[\s\S]{0,250}?([\d,]{5,})/i];
  let taelBuy=0;for(const p of pats){const m=html.match(p);if(m){taelBuy=clean(m[1]);if(taelBuy>50000)break}}
  if(!taelBuy)throw new Error('無法解析臺銀一台兩黃金買進價');
  return NextResponse.json({ok:true,source:'臺灣銀行黃金牌價',valuation:'一台兩黃金條塊本行買進參考價',taelBuy,qianBuy:taelBuy/10,updatedAt:new Date().toISOString()})
 }catch(e){return NextResponse.json({ok:false,error:e.message||'無法取得臺銀黃金牌價'},{status:502})}
}
