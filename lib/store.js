// 共用工具：Vercel Blob（私密）讀寫、資料整理、回應格式
import { put, get, list } from '@vercel/blob';

export const TZ = 'Asia/Taipei';

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

// 讀一個 JSON 檔；不存在回傳 null
export async function readJSON(pathname) {
  try {
    const r = await get(pathname, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const text = await new Response(r.stream).text();
    return JSON.parse(text);
  } catch (e) {
    if (e && /not ?found/i.test(String(e.name) + String(e.message))) return null;
    throw e;
  }
}

export async function writeJSON(pathname, obj) {
  await put(pathname, JSON.stringify(obj), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json'
  });
}

export async function listPaths(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs.map(b => b.pathname));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

// 全形轉半形、去空白；座號去掉前面的 0
export function normCls(v) {
  return String(v == null ? '' : v)
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '').slice(0, 40);
}
export function normSeat(v) {
  const t = normCls(v);
  return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t;
}
export function clip(v, n = 60000) {
  return String(v == null ? '' : v).slice(0, n);
}
export const keyOf = (cls, seat) => encodeURIComponent(cls) + '_' + encodeURIComponent(seat);
export const paths = key => ({
  student: `students/${key}.json`,   // 學生的內容（自動同步、送出）
  progress: `progress/${key}.json`,  // 每週回報
  teacher: `teacher/${key}.json`     // 老師的建議、關卡、回覆
});
export const ROSTER = 'config/roster.json';

export function fmt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('zh-TW', { timeZone: TZ, hour12: false });
  } catch (e) { return String(iso); }
}

// 名單核對：回傳錯誤訊息，沒問題回傳空字串
export function checkRoster(roster, cls, seat, name, email) {
  if (!roster || !roster.length) return '';
  const hit = roster.find(r => r.cls === cls && r.seat === seat);
  if (!hit) return `名單裡找不到「${cls} 班 ${seat} 號」，請檢查班級和座號。`;
  if (hit.name !== name) return `這個座號在名單上的姓名不是「${name}」，請檢查姓名有沒有打錯。`;
  if (hit.email && email && hit.email !== String(email).toLowerCase()) {
    return '這個座號登記的學校帳號，和你現在登入的帳號不同。請用自己的帳號登入，或請老師確認名單。';
  }
  return '';
}

// Google 學校帳號驗證
export async function verifyGoogle(token, clientId, domain) {
  if (!token) return { err: '請先用學校帳號登入。' };
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
  if (!r.ok) return { err: '登入已經過期，請重新登入後再試一次。' };
  const t = await r.json();
  if (t.aud !== clientId) return { err: '登入資訊不正確，請重新登入。' };
  const email = String(t.email || '').toLowerCase();
  if (t.hd !== domain || String(t.email_verified) !== 'true' || !email.endsWith('@' + domain)) {
    return { err: `只限 @${domain} 學校帳號使用。` };
  }
  if (Number(t.exp) * 1000 < Date.now()) return { err: '登入已經過期，請重新登入後再試一次。' };
  return { email };
}
