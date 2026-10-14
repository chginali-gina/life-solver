// 學生端 API：建立身分、自動同步、送出、讀取老師建議、每週回報
import {
  json, readJSON, writeJSON, normCls, normSeat, clip, keyOf, paths, ROSTER, fmt, checkRoster, verifyGoogle
} from '../lib/store.js';

const CLASS_CODE = process.env.CLASS_CODE || 'fengxin2026';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DOMAIN = process.env.ALLOWED_DOMAIN || 'fhsh.khc.edu.tw';
const FIELDS = ['observe', 'problem', 'root', 'scale', 'option', 'mine', 'mvp', 'measure', 'first',
  'resources', 'result', 'logs', 'reflect', 'full', 'step', 'backup'];

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ ok: true, msg: '生活觀察解題室 API 運作中' });
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
      return json({ ok: false, msg: '老師還沒有建立資料庫，請先告訴老師。' });
    }
    let d;
    try { d = JSON.parse(await request.text()); }
    catch (e) { return json({ ok: false, msg: '資料格式錯誤，請重新整理頁面再試一次。' }); }

    if (String(d.code || '').trim() !== CLASS_CODE) return json({ ok: false, msg: '班級代碼不正確，請向老師確認。' });
    const cls = normCls(d.cls), seat = normSeat(d.seat), name = normCls(d.name);
    if (!cls || !seat || !name) return json({ ok: false, msg: '請填寫班級、座號和姓名。' });

    try {
      let email = '';
      if (CLIENT_ID) {
        const g = await verifyGoogle(d.idToken, CLIENT_ID, DOMAIN);
        if (g.err) return json({ ok: false, msg: g.err, relogin: true });
        email = g.email;
      }
      const roster = (await readJSON(ROSTER)) || [];
      const err = checkRoster(roster, cls, seat, name, email);
      if (err) return json({ ok: false, msg: err });

      const P = paths(keyOf(cls, seat));
      const now = new Date().toISOString();

      switch (d.action) {
        case 'verify':
          return json({ ok: true, roster: roster.length > 0 });

        case 'sync':      // 自動同步
        case 'problem': { // 學生按「送出」
          const cur = (await readJSON(P.student)) || {};
          const isSubmit = d.action === 'problem';
          const rec = {
            cls, seat, name,
            email: email || cur.email || '',
            createdAt: cur.createdAt || now,
            syncAt: now,
            submittedAt: isSubmit ? now : (cur.submittedAt || ''),
            count: (cur.count || 0) + (isSubmit ? 1 : 0)
          };
          FIELDS.forEach(f => { rec[f] = clip(d[f], f === 'backup' || f === 'full' ? 400000 : 60000); });
          await writeJSON(P.student, rec);
          return json({ ok: true, msg: '已送出', count: rec.count });
        }

        case 'problemFb': {
          const cur = await readJSON(P.student);
          if (!cur) return json({ ok: false, msg: '還找不到你的資料，請先送出或等自動同步。' });
          if (cur.name !== name) return json({ ok: false, msg: '姓名和送出時填的不一樣，請檢查。' });
          const t = (await readJSON(P.teacher)) || {};
          return json({ ok: true, feedback: t.fb || '', gate: t.gate || '待審', at: fmt(t.fbAt) });
        }

        case 'progress': {
          const list = (await readJSON(P.progress)) || [];
          list.push({
            at: now, week: clip(d.week, 20), done: clip(d.done, 5000), next: clip(d.next, 5000),
            stuck: clip(d.stuck, 5000), help: clip(d.help, 20), name, email
          });
          await writeJSON(P.progress, list);
          return json({ ok: true, msg: '已送出' });
        }

        case 'replies': {
          const list = (await readJSON(P.progress)) || [];
          const t = (await readJSON(P.teacher)) || {};
          const rep = t.replies || {};
          return json({ ok: true, replies: list.map(p => ({ at: fmt(p.at), week: p.week, reply: rep[p.at] || '' })) });
        }
      }
      return json({ ok: false, msg: '不認得的動作。' });
    } catch (e) {
      console.error(e);
      return json({ ok: false, msg: '系統忙碌中，請稍後再試一次。' });
    }
  }
};
