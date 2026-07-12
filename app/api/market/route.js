import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
const num=v=>{const n=Number(String(v??'').replaceAll(',',''));return Number.isFinite(n)?n:0};
export async function GET(request){
  const symbol=(new URL(request.url).searchParams.get('symbol')||'009816').trim();
  const ex=['tse_'+symbol+'.tw','otc_'+symbol+'.tw','tse_t00.tw'].join('|');
  const url='https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch='+encodeURIComponent(ex)+'&json=1&delay=0';
  try{
    const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':'Mozilla/5.0',Referer:'https://mis.twse.com.tw/stock/index.jsp'}});
    if(!r.ok) throw new Error('TWSE HTTP '+r.status);
    const d=await r.json(),rows=Array.isArray(d.msgArray)?d.msgArray:[];
    const s=rows.find(x=>x.c===symbol),i=rows.find(x=>x.ch==='t00.tw'||x.c==='t00');
    if(!s)return NextResponse.json({ok:false,error:'找不到代號 '+symbol},{status:404});
    const price=num(s.z)||num(s.y),prev=num(s.y),ip=i?(num(i.z)||num(i.y)):0,ipp=i?num(i.y):0;
    return NextResponse.json({ok:true,updatedAt:s.tlong?new Date(Number(s.tlong)).toISOString():new Date().toISOString(),stock:{symbol,name:s.n||symbol,price,previousClose:prev,change:price-prev,changePercent:prev?((price/prev)-1)*100:0},taiex:{price:ip,previousClose:ipp,change:ip-ipp,changePercent:ipp?((ip/ipp)-1)*100:0}})
  }catch(e){return NextResponse.json({ok:false,error:e.message||'無法取得證交所資料'},{status:502})}
}
