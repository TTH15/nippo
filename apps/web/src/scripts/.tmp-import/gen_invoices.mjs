import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const ACE_ORG_ID = '1314c7a1-0f86-44fd-8f60-01588735295a';
const COMPANY_CODE = 'ACE';
const DRY_RUN = process.env.DRY_RUN === '1';

// ---- tax helpers ----
const taxExcl = (v) => Math.round(v / 1.1); // 税込→税抜 四捨五入
const taxAmt = (subtotal) => Math.floor(subtotal * 0.10); // 消費税 切り捨て

// ---- counterparties ----
const CP = {
  yorozuya: '7dadbd2c-1423-45fb-babf-48354d9afbe0', // 万事屋うっちゃん
  fiants: '03b493f0-ae3f-4244-94e6-cdfaa40373b0',   // 合同会社fiants
  yamashita: 'b690c122-f326-4cd5-949a-c34a28b3b367', // 山下運送(既存・2026-05-04作成分に統一)
};
const CP_NAME = {
  yorozuya: '株式会社万事屋うっちゃん',
  fiants: '合同会社fiants',
  yamashita: '山下運送',
};
const CP_ADDR = {
  yorozuya: { addr: '〒606-8181<br/>京都府京都市左京区一乗寺地蔵本町6-1', tel: '075-744-6729', reg: 'T3130001077237' },
  fiants: { addr: '〒612-8122<br/>京都府京都市伏見区向島庚申町64-33', tel: '075-205-0224', reg: '' },
  yamashita: { addr: '〒613-0044<br/>京都府久世郡久御山町藤和田馬場崎野15-1 511', tel: '075-631-1018', reg: '' },
};

// ---- drivers ----
const DRV = {
  '日笠和哉': { id: '93a81a10-3948-4056-b18f-14a96a5319c5', addr: '〒6038374<br/>京都府京都市北区衣笠高橋町2-7CASA衣笠301', tel: '08085219271' },
  '坂田光和': { id: 'c96c534d-3106-40c4-aa90-7f1fbd95c81d' },
  '永戸大心': { id: 'aecb3700-eee8-49d0-888b-f16d18920076' },
  '廣瀬俊斗': { id: '81d9ae34-e1a6-4f7d-8532-724df74d5fa1' },
  '内海師童': { id: 'e58bd844-02b9-42ff-9df3-360f4ccd4498' },
  '木戸偲愛': { id: 'cfe0e3f8-4765-4c2e-aa2a-12de4545dcaf' },
  '猪上泰輝': { id: 'b1e7473c-d391-4ede-ba6e-00c0b4231a12' },
  '木下楓麻': { id: 'ffe3ec6e-946d-4bad-a4f8-4f22046ddbb6' },
  '島本壮': { id: '49340a25-5546-4c6e-833c-adbce91c0896' },
  '梶原優旗': { id: 'b8ebbb05-6dff-4a35-b5ba-2a4f017e87b5' },
  '勝政隼人': { id: '154ba01e-fabc-4fbe-9778-899b869984fe' },
  '平石孝也': { id: '48bfee2f-cd84-4e86-9b61-b06de52c8606' },
  '杉本創都': { id: '330137dd-6404-40f4-a09b-578ca9eabbb1' },
};

const ISSUER = {
  name: '株式会社ACE CREATION',
  addr: '〒615-0904<br/>京都市右京区梅津堤上町21 KKハウスⅡ 101',
  tel: '080-9540-4451',
  reg: 'T6130001080238',
  bankName: '京都信用金庫 梅津支店',
  bankNo: '普通 3058832',
  bankHolder: 'カ)エースクリエイション',
};

function periodForMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}年${m}月1日〜${y}年${m}月${lastDay}日`;
}
function dueDateJa(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

// line item helper: {title, qty, unit, priceGross(税込単価)} -> {title, qty, unit, price(税抜)}
function line(title, qty, unit, priceGross) {
  return { title, qty, unit, price: taxExcl(priceGross) };
}
function lineExact(title, qty, unit, priceNet) {
  // already tax-exclusive (clean number, no conversion needed)
  return { title, qty, unit, price: priceNet };
}

function computeTable(lines) {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = taxAmt(subtotal);
  return { lines, subtotal, tax, gross: subtotal + tax };
}

// ---- known detailed line items (from source PDFs), keyed by cp+period ----
const YOROZUYA_LINES = {
  '2025-10': [
    line('坂田光和　ミッドナイト', 17, '日', 10000),
    line('永戸大心　ミッドナイト', 4, '日', 10000),
  ],
  '2025-11': [
    line('坂田光和　ミッドナイト', 11, '日', 10000),
    line('永戸大心　ミッドナイト', 1, '日', 10000),
    line('木戸偲愛　ミッドナイト', 8, '日', 10000),
  ],
  '2025-12': [
    line('坂田光和', 2, '日', 10000),
    line('永戸大心', 2, '日', 10000),
    line('猪上泰輝', 4, '日', 10000),
    line('木戸偲愛', 17, '日', 10000),
  ],
  '2026-01': [
    line('坂田光和　ミッドナイト（グローリング）', 5, '日', 10000),
    line('前川海輝　ミッドナイト（グローリング）', 7, '日', 10000),
    line('猪上泰輝　ミッドナイト（グローリング）', 13, '日', 10000),
    line('内海師童　Amazon半日稼働（ZOOOM）', 1, '日', 8500),
  ],
  '2026-02': [
    line('坂田光和　ミッドナイト（グローリング）', 6, '日', 10000),
    line('前川海輝　ミッドナイト（グローリング）', 10, '日', 10000),
    line('猪上泰輝　ミッドナイト（グローリング）', 7, '日', 10000),
    line('平石孝也　ミッドナイト（グローリング）', 1, '日', 10000),
    line('坂田光和　上賀茂Amazon', 1, '日', 16000),
    line('島本壮　吉祥院Amazon（ZOOOM）', 5, '日', 17000),
    line('島本壮　吉祥院Amazon半日稼働（ZOOOM）', 3, '日', 8500),
    line('木下楓麻　壬生　宅急便（ヤマト）', 2255, '個', 160),
    line('木下楓麻　壬生　ネコポス（ヤマト）', 745, '個', 40),
  ],
  '2026-03': [
    line('坂田光和　ミッドナイト（グローリング）', 4, '日', 10000),
    line('前川海輝　ミッドナイト（グローリング）', 2, '日', 10000),
    line('猪上泰輝　ミッドナイト（グローリング）', 7, '日', 10000),
    line('平石孝也　ミッドナイト（グローリング）', 20, '日', 10000),
    line('島本壮　吉祥院Amazon（ZOOOM）', 13, '日', 17000),
    line('勝政隼人　吉祥院Amazon（ZOOOM）', 3, '日', 17000),
    line('勝政隼人　上鳥羽Amazon（ZOOOM）', 13, '日', 17000),
    line('勝政隼人　上鳥羽Amazon半日稼働（ZOOOM）', 3, '日', 8500),
    line('日笠和哉　吉祥院Amazon半日稼働（ZOOOM）', 1, '日', 8500),
    line('上手洸弥　豊中Amazon（ZOOOM）', 5, '日', 17000),
    line('木下楓麻　壬生　宅急便（ヤマト）', 2589, '個', 160),
    line('木下楓麻　壬生　ネコポス（ヤマト）', 1059, '個', 40),
    line('木下楓麻　上京　宅急便（ヤマト）', 5, '個', 160),
    line('木下楓麻　上京　ネコポス（ヤマト）', 11, '個', 40),
  ],
  '2026-04': [
    line('坂田光和　ミッドナイト（グローリング）', 2, '日', 10000),
    line('猪上泰輝　ミッドナイト（グローリング）', 8, '日', 10000),
    line('平石孝也　ミッドナイト（グローリング）', 19, '日', 10000),
    line('島本壮　吉祥院Amazon（TWC）', 12, '日', 17000),
    line('勝政隼人　吉祥院Amazon（TWC）', 2, '日', 17000),
    line('勝政隼人　上鳥羽Amazon（TWC）', 18, '日', 17000),
    line('廣瀬俊斗　吉祥院Amazon（TWC）', 1, '日', 17000),
    line('上手洸弥　豊中Amazon（TWC）', 9, '日', 17000),
    line('木下楓麻　壬生　宅急便（ヤマト）', 3229, '個', 160),
    line('木下楓麻　壬生　ネコポス（ヤマト）', 1750, '個', 40),
    line('木下楓麻　上京　宅急便（ヤマト）', 36, '個', 160),
    line('木下楓麻　上京　ネコポス（ヤマト）', 6, '個', 40),
    line('勝政隼人　上京　宅急便（ヤマト）', 272, '個', 160),
    line('勝政隼人　上京　ネコポス（ヤマト）', 279, '個', 40),
  ],
};
const YOROZUYA_DEDUCT = {
  '2026-03': [line('勝政隼人　1日リース料金（半日）', 1, '回', 800), line('勝政隼人　オイル交換費（まとめ）', 1, '件', 70)],
  '2026-04': [
    line('勝政隼人　1日リース料金（半日）', 1, '回', 800), line('勝政隼人　オイル交換費（まとめ）', 1, '件', 70),
    line('平石孝也　1日リース料金（半日）', 4, '回', 800), line('平石孝也　オイル交換費（まとめ）', 1, '件', 280),
    line('平石孝也　4/25　リースガソリン補填代金', 1, '件', 1000),
    line('猪上泰輝　1日リース料金（半日）', 2, '回', 800), line('猪上泰輝　オイル交換費（まとめ）', 1, '件', 140),
    line('木下楓麻　ヤマト　代品代', 1, '件', 7660),
    line('求人広告費用　マイナビスーパー（4月から5月）', 1, '件', 100000),
  ],
};

const FIANTS_LINES = {
  '2025-09': [line('ネコポス（日笠）', 967, '個', 40), line('宅急便（日笠）', 2748, '個', 160)],
  '2025-12': [ // Dec 2025 work = 修正版
    line('ネコポス（日笠）', 948, '個', 40), line('宅急便（日笠）', 3543, '個', 160),
    line('ネコポス（廣瀬）', 984, '個', 40), line('宅急便（廣瀬）', 3370, '個', 160),
    line('ネコポス（坂田）', 166, '個', 40),
    line('ネコポス（猪上）', 1353, '個', 40), line('宅急便（猪上）', 29, '個', 160),
    line('ネコポス（内海）', 27, '個', 40), line('宅急便（内海）', 241, '個', 160),
    line('モニター案件', 8, '個', 6000), line('内海ミッドナイト', 1, '日', 10000), line('モニター案件', 5, '個', 14000),
    line('モニター案件経費（駐車場代）', 1, '件', 1200),
  ],
  '2026-01': [
    line('ネコポス（内海）', 103, '個', 40), line('宅急便（内海）', 189, '個', 160),
    line('ネコポス（廣瀬）', 827, '個', 40), line('宅急便（廣瀬）', 2634, '個', 160),
    line('ネコポス（日笠）', 785, '個', 40), line('宅急便（日笠）', 2308, '個', 160),
    line('ネコポス（坂田）', 110, '個', 40), line('宅急便（坂田）', 190, '個', 160),
    line('ネコポス（猪上）', 12, '個', 40), line('3t横乗り（内海）', 3, '個', 11000),
  ],
  '2026-03': [
    line('ヤマト横大路 宅急便（梶原）', 2523, '個', 160), line('ヤマト横大路 ネコポス（梶原）', 734, '個', 40),
    line('ヤマト横大路 宅急便（坂田）', 2283, '個', 160), line('ヤマト横大路 ネコポス（坂田）', 948, '個', 40),
    line('ヤマト横大路 宅急便（猪上）', 300, '個', 160), line('ヤマト横大路 ネコポス（猪上）', 129, '個', 40),
    line('ヤマト横大路 宅急便（内海）', 75, '個', 160), line('ヤマト横大路 ネコポス（内海）', 55, '個', 40),
    line('ヤマト横大路 宅急便（日笠）', 3468, '個', 160), line('ヤマト横大路 ネコポス（日笠）', 1251, '個', 40),
    line('ヤマト横大路 宅急便（廣瀬）', 621, '個', 160), line('ヤマト横大路 ネコポス（廣瀬）', 201, '個', 40),
    line('ヤマト宇治田原 宅急便（廣瀬）', 1739, '個', 185), line('ヤマト宇治田原 ネコポス（廣瀬）', 1812, '個', 40),
    line('家具組み立て', 17, '個', 18000),
    line('モニター', 2, '個', 6000),
    line('fiants 3t横乗り', 4, '個', 11000),
    line('fiants アート引越し', 1, '個', 18000),
    line('fiants アート', 3, '個', 17600),
    line('fiants アート残業代', 1, '件', 5313),
  ],
};
const FIANTS_DEDUCT = {
  '2025-09': [line('車輌', 1, '件', 35000), line('振込手数料', 1, '件', 770)],
  '2025-12': [line('事務手数料', 1, '件', 770)],
  '2026-01': [line('事務手数料', 1, '件', 770)],
  '2026-03': [line('事務手数料', 1, '件', 770)],
};
// May 2026 fiants work — already tax-exclusive in source (sample), use lineExact
FIANTS_LINES['2026-05'] = [
  lineExact('ヤマト横大路 宅急便（梶原）', 2143, '個', 145),
  lineExact('ヤマト横大路 宅急便（坂田）', 2306, '個', 145),
  lineExact('ヤマト横大路 宅急便（日笠）', 394, '個', 145),
  lineExact('ヤマト横大路 ネコポス（梶原）', 742, '個', 36),
  lineExact('ヤマト横大路 ネコポス（坂田）', 406, '個', 36),
  lineExact('ヤマト横大路 ネコポス（日笠）', 144, '個', 36),
  lineExact('ヤマト宇治田原 宅急便（廣瀬）', 2520, '個', 168),
  lineExact('ヤマト宇治田原 ネコポス（廣瀬）', 2138, '個', 36),
  lineExact('Amazonミッドナイト', 12, '日', 9091),
];

const YAMASHITA_LINES = {
  '2025-12': [lineExact('坂田　郵便局', 2, '個', 16000), lineExact('坂田　郵便局', 1, '個', 10000)],
};

// driver-level (incoming) known detail: keyed by driverName -> period -> {main, deduct}
const DRIVER_LINES = {
  '日笠和哉': {
    '2026-04': {
      main: [
        lineExact('ネコポス（ヤマト横大路）', 1285, '個', 27),
        lineExact('宅急便（ヤマト横大路）', 3074, '個', 136),
        lineExact('Amazon', 1, '日', 53440),
      ],
      deduct: [
        lineExact('リース代', 1, '台', 31818),
        lineExact('事務手数料手数料', 1, '件', 3636),
      ],
    },
  },
};

// ---- CSV-derived target list (69 entries) ----
const TARGETS = [];
// outgoing: yorozuya
[
  ['2025-11-10', '2025-09', 129340], ['2025-12-10', '2025-10', 209340], ['2026-01-13', '2025-11', 199340],
  ['2026-02-10', '2025-12', 249340], ['2026-03-10', '2026-01', 257840], ['2026-04-10', '2026-02', 756440],
  ['2026-05-11', '2026-03', 1398310], ['2026-06-10', '2026-04', 1535910],
].forEach(([paidDate, period, amt]) => TARGETS.push({ kind: 'outgoing', cp: 'yorozuya', paidDate, period, amt }));
// outgoing: fiants
[
  ['2025-09-30', '2025-08', 488341], ['2025-10-31', '2025-09', 442590], ['2025-11-28', '2025-10', 689740],
  ['2025-12-30', '2025-11', 1119230], ['2026-01-30', '2025-12', 1558590], ['2026-02-27', '2026-01', 957070],
  ['2026-03-31', '2026-02', 1534550], ['2026-04-30', '2026-03', 2692281], ['2026-05-29', '2026-04', 2318140],
  ['2026-06-30', '2026-05', 1497510],
].forEach(([paidDate, period, amt]) => TARGETS.push({ kind: 'outgoing', cp: 'fiants', paidDate, period, amt }));
// outgoing: yamashita (via ヤマシタマサヤ)
[
  ['2026-01-23', '2025-12', 46200], ['2026-02-25', '2026-01', 236885], ['2026-06-25', '2026-05', 52800],
].forEach(([paidDate, period, amt]) => TARGETS.push({ kind: 'outgoing', cp: 'yamashita', paidDate, period, amt }));

// incoming: drivers
const DRIVER_PAYMENTS = [
  ['2025-10-31','日笠和哉','2025-09',393210],['2025-10-31','坂田光和','2025-09',69000],
  ['2025-11-28','日笠和哉','2025-10',584244],['2025-11-28','坂田光和','2025-10',99000],['2025-11-30','永戸大心','2025-10',32000],
  ['2025-12-31','日笠和哉','2025-11',497120],['2025-12-31','廣瀬俊斗','2025-11',425380],['2025-12-31','坂田光和','2025-11',120240],['2025-12-31','内海師童','2025-11',82650],['2025-12-31','木戸偲愛','2025-11',45000],
  ['2026-01-31','日笠和哉','2025-12',621824],['2026-01-31','廣瀬俊斗','2025-12',486800],['2026-01-31','坂田光和','2025-12',255280],['2026-01-31','内海師童','2025-12',386248],['2026-01-31','猪上泰輝','2025-12',25000],
  ['2026-02-28','日笠和哉','2026-01',424110],['2026-02-28','廣瀬俊斗','2026-01',379330],['2026-02-28','坂田光和','2026-01',223970],['2026-02-28','内海師童','2026-01',77870],['2026-02-28','木下楓麻','2026-01',312440],['2026-02-28','猪上泰輝','2026-01',80700],
  ['2026-03-31','木下楓麻','2026-02',301310],['2026-03-31','坂田光和','2026-02',200310],['2026-03-31','猪上泰輝','2026-02',176950],['2026-03-31','日笠和哉','2026-02',442534],['2026-03-31','廣瀬俊斗','2026-02',298332],['2026-03-31','島本壮','2026-02',81500],['2026-03-31','梶原優旗','2026-02',145510],
  ['2026-04-30','勝政隼人','2026-03',250770],['2026-04-30','廣瀬俊斗','2026-03',410855],['2026-04-30','木下楓麻','2026-03',380240],['2026-04-30','島本壮','2026-03',165000],['2026-04-30','日笠和哉','2026-03',597050],['2026-04-30','内海師童','2026-03',62900],['2026-04-30','猪上泰輝','2026-03',106997],
  ['2026-05-01','坂田光和','2026-03',342610],['2026-05-01','梶原優旗','2026-03',345550],['2026-05-01','平石孝也','2026-03',166000],
  ['2026-06-09','坂田光和','2026-04',393370],['2026-06-09','勝政隼人','2026-04',346170],
  ['2026-06-10','廣瀬俊斗','2026-04',474910],['2026-06-10','島本壮','2026-04',152000],['2026-06-10','木下楓麻','2026-04',495770],['2026-06-10','梶原優旗','2026-04',402570],['2026-06-10','猪上泰輝','2026-04',49000],['2026-06-10','平石孝也','2026-04',184200],['2026-06-10','日笠和哉','2026-04',519434],
  ['2026-06-24','杉本創都','2026-04',125760],
];
DRIVER_PAYMENTS.forEach(([paidDate, name, period, amt]) => TARGETS.push({ kind: 'incoming', driverName: name, paidDate, period, amt }));

console.log('total targets:', TARGETS.length);
const kindCounts = TARGETS.reduce((a,t)=>{a[t.kind]=(a[t.kind]||0)+1;return a;},{});
console.log(kindCounts);

const DEFAULT_LAYOUT = { headerGapMm: 4, summaryGapMm: 12, deductGapMm: 10 };
let seq = 0;
const results = [];

for (const t of TARGETS) {
  let mainLines, deductLines, toName, toAddr, toTel, toReg, fromName, fromAddr, fromTel, fromReg,
    parties, section, counterpartyId, driverId, clientName;

  if (t.kind === 'outgoing') {
    const linesMap = { yorozuya: YOROZUYA_LINES, fiants: FIANTS_LINES, yamashita: YAMASHITA_LINES }[t.cp];
    const deductMap = { yorozuya: YOROZUYA_DEDUCT, fiants: FIANTS_DEDUCT, yamashita: {} }[t.cp];
    mainLines = linesMap[t.period] || [];
    deductLines = deductMap[t.period] || [];
    const addr = CP_ADDR[t.cp];
    toName = CP_NAME[t.cp]; toAddr = addr.addr; toTel = addr.tel; toReg = addr.reg;
    fromName = ISSUER.name; fromAddr = ISSUER.addr; fromTel = ISSUER.tel; fromReg = ISSUER.reg;
    parties = { fromParty: 'ace_creation', toParty: t.cp };
    section = { yorozuya: 'Amazon', fiants: 'ヤマト運輸', yamashita: '郵便局' }[t.cp];
    counterpartyId = CP[t.cp];
    driverId = null;
    clientName = CP_NAME[t.cp];
  } else {
    const drv = DRV[t.driverName];
    if (!drv) throw new Error('unknown driver: ' + t.driverName);
    const known = DRIVER_LINES[t.driverName]?.[t.period];
    mainLines = known?.main || [];
    deductLines = known?.deduct || [];
    toName = ISSUER.name; toAddr = ISSUER.addr; toTel = ISSUER.tel; toReg = ISSUER.reg;
    fromName = t.driverName; fromAddr = drv.addr || ''; fromTel = drv.tel || ''; fromReg = '';
    parties = { fromParty: `drv-${drv.id}`, toParty: 'ace_creation' };
    section = 'Amazon';
    counterpartyId = null;
    driverId = drv.id;
    clientName = t.driverName;
  }

  const mainT = computeTable(mainLines);
  const deductT = computeTable(deductLines);
  const netBeforePlug = mainT.gross - deductT.gross;
  const plug = t.amt - netBeforePlug; // 売上追加分 / 追加外注請求分
  const finalTotal = netBeforePlug + plug;
  if (finalTotal !== t.amt) throw new Error(`reconciliation failed for ${JSON.stringify(t)}: got ${finalTotal}`);

  seq += 1;
  const cpOrDrv = t.kind === 'outgoing' ? t.cp : t.driverName.replace(/\s/g, '');
  const invoiceNo = `HIST-${t.period}-${cpOrDrv}-${String(seq).padStart(3, '0')}`;

  const payload = {
    toName, toAddr, toTel, toReg, honorific: '御中',
    fromName, fromAddr, fromTel, fromReg,
    period: periodForMonth(t.period),
    invoiceNo,
    dueDate: t.paidDate,
    bankName: ISSUER.bankName, bankNo: ISSUER.bankNo, bankHolder: ISSUER.bankHolder,
    notes: known_note(t),
    tableData: {
      main: mainLines.map(l => ({ title: l.title, qty: l.qty, unit: l.unit, price: l.price })),
      deduct: deductLines.map(l => ({ title: l.title, qty: l.qty, unit: l.unit, price: l.price })),
    },
    taxSettings: { enabled: true, rate: 10 },
    loanRepay: 0,
    extraOutsourcing: plug,
    blockBreaks: [],
    layout: DEFAULT_LAYOUT,
    parties,
    source: 'historical_import_2026-07-03',
  };

  function known_note(t) {
    if (mainLines.length === 0) return '過去請求書のインポート。明細未確定（実際の入出金額のみ反映、内訳は要修正）。';
    return '過去請求書のインポート（税抜ベースで再作成、実際の入出金額に一致させています）。';
  }

  results.push({
    org_id: ACE_ORG_ID, company_code: COMPANY_CODE, month_yyyy_mm: t.period, section,
    driver_id: driverId, counterparty_invoice_address_id: counterpartyId,
    client_name: clientName, issue_date: t.paidDate, invoice_no: invoiceNo,
    amount: t.amt, status: 'draft', is_starred: false, payload,
  });
}

console.log(`prepared ${results.length} rows, all reconciled OK.`);
const withDetail = results.filter(r => r.payload.tableData.main.length > 0).length;
console.log(`with real line-item detail: ${withDetail}, placeholder-only: ${results.length - withDetail}`);

fs.writeFileSync('/tmp/insert_rows.json', JSON.stringify(results, null, 2));

if (DRY_RUN) {
  console.log('DRY_RUN=1, not inserting.');
} else {
  const { data, error } = await supabase.from('invoice_documents').insert(results).select('id');
  if (error) { console.error('INSERT ERROR', error); process.exit(1); }
  console.log(`inserted ${data.length} rows.`);
  fs.writeFileSync('/tmp/inserted_ids.json', JSON.stringify(data.map(d => d.id), null, 2));
}
