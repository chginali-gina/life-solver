// 老師端 API：全班總覽、個別學生詳細內容、寫建議與關卡、回覆週報、名單管理、匯出
import { timingSafeEqual } from 'node:crypto';
import {
  json, readJSON, writeJSON, listPaths, normCls, normSeat, clip, keyOf, paths, ROSTER, fmt
} from '../lib/store.js';

const GATES = ['待審', '需修改', '選題通過', '計畫通過', '期中通過', '完成'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function passwordOK(given) {
  const real = process.env.TEACHER_PASSWORD || '';
  if (!real || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

const keyFromPath = p => p.replace(/^[a-z]+\//, '').replace(/\.json$/, '');

async function loadAll() {
  const [sp, pp, tp] = await Promise.all([listPaths('students/'), listPaths('progress/'), listPaths('teacher/')]);
  const keys = [...new Set([...sp, ...pp].map(keyFromPath))];
  const tset = new Set(tp.map(keyFromPath)), pset = new Set(pp.map(keyFromPath)), sset = new Set(sp.map(keyFromPath));
  const rows = await Promise.all(keys.map(async key => {
    const P = paths(key);
    const [s, p, t] = await Promise.all([
      sset.has(key) ? readJSON(P.student) : null,
      pset.has(key) ? readJSON(P.progress) : null,
      tset.has(key) ? readJSON(P.teacher) : null
    ]);
    return { key, s: s || {}, p: p || [], t: t || {} };
  }));
  return rows;
}

function summary({ key, s, p, t }) {
  const last = p[p.length - 1];
  const rep = t.replies || {};
  return {
    key, cls: s.cls || decodeURIComponent(key.split('_')[0]), seat: s.seat || decodeURIComponent(key.split('_')[1] || ''),
    name: s.name || (last && last.name) || '', email: s.email || '',
    step: s.step || '', syncAt: fmt(s.syncAt), syncIso: s.syncAt || '', submittedAt: fmt(s.submittedAt), count: s.count || 0,
    gate: t.gate || '待審', fb: t.fb || '', fbAt: fmt(t.fbAt),
    weeks: p.length, lastWeek: last ? last.week : '',
    needHelp: p.some(x => x.help === '需要' && !rep[x.at]),
    stepNo: s.stepNo || '',
    // 你上次打開這位學生之後，學生又更新了
    isNew: !!((s.changedAt || s.syncAt) && (!t.seenAt || (s.changedAt || s.syncAt) > t.seenAt)),
    // 學生按了「請老師審核」，而你還沒有在那之後儲存建議或關卡
    review: !!(s.submittedAt && (!t.reviewedAt || s.submittedAt > t.reviewedAt)),
    newWeek: p.some(x => !rep[x.at] && (!t.seenAt || x.at > t.seenAt)),
    unreplied: p.filter(x => !rep[x.at]).length
  };
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ ok: false, msg: '請從老師後台頁面使用。' }, 405);
    if (!process.env.TEACHER_PASSWORD) return json({ ok: false, msg: '還沒有設定老師密碼（環境變數 TEACHER_PASSWORD）。' });
    if (!passwordOK(request.headers.get('x-teacher-password'))) {
      await sleep(800);
      return json({ ok: false, msg: '密碼不正確。', auth: false }, 401);
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
      return json({ ok: false, msg: '還沒有建立資料庫（Vercel Blob），請先在 Vercel 建立並連到這個專案。' });
    }
    let d;
    try { d = JSON.parse(await request.text()); } catch (e) { return json({ ok: false, msg: '資料格式錯誤。' }); }

    try {
      switch (d.action) {
        case 'overview': {
          const rows = await loadAll();
          const roster = (await readJSON(ROSTER)) || [];
          const list = rows.map(summary);
          const have = new Set(list.map(x => x.cls + '|' + x.seat));
          roster.forEach(r => {
            if (!have.has(r.cls + '|' + r.seat)) {
              list.push({ key: keyOf(r.cls, r.seat), cls: r.cls, seat: r.seat, name: r.name, email: r.email || '',
                step: '', syncAt: '', syncIso: '', submittedAt: '', count: 0, gate: '', fb: '', fbAt: '',
                weeks: 0, lastWeek: '', needHelp: false, unreplied: 0, notStarted: true });
            }
          });
          list.sort((a, b) => String(a.cls).localeCompare(String(b.cls), 'zh-TW', { numeric: true }) || (Number(a.seat) || 0) - (Number(b.seat) || 0));
          return json({ ok: true, list, rosterCount: roster.length });
        }

        case 'detail': {
          const P = paths(String(d.key || ''));
          const [s, p, t0] = await Promise.all([readJSON(P.student), readJSON(P.progress), readJSON(P.teacher)]);
          if (!s && !p) return json({ ok: false, msg: '這位學生還沒有任何資料。' });
          const t = t0 || {};
          t.seenAt = new Date().toISOString(); // 記下老師看過的時間，列表的「新」標記就會消失
          await writeJSON(P.teacher, t);
          const rep = t.replies || {};
          return json({
            ok: true,
            student: s ? { ...s, syncAt: fmt(s.syncAt), submittedAt: fmt(s.submittedAt) } : {},
            progress: (p || []).map(x => ({ ...x, atText: fmt(x.at), reply: rep[x.at] || '' })),
            teacher: { fb: (t && t.fb) || '', gate: (t && t.gate) || '待審', fbAt: fmt(t && t.fbAt) }
          });
        }

        case 'saveFeedback': {
          const P = paths(String(d.key || ''));
          const t = (await readJSON(P.teacher)) || {};
          const fb = clip(d.fb, 5000);
          if (fb !== (t.fb || '')) { t.fb = fb; t.fbAt = fb ? new Date().toISOString() : ''; }
          if (d.gate && GATES.includes(d.gate)) t.gate = d.gate;
          t.reviewedAt = new Date().toISOString();
          await writeJSON(P.teacher, t);
          return json({ ok: true, fbAt: fmt(t.fbAt) });
        }

        case 'reply': {
          const P = paths(String(d.key || ''));
          const t = (await readJSON(P.teacher)) || {};
          t.replies = t.replies || {};
          t.replies[String(d.at)] = clip(d.text, 5000);
          await writeJSON(P.teacher, t);
          return json({ ok: true });
        }

        case 'getRoster':
          return json({ ok: true, roster: (await readJSON(ROSTER)) || [] });

        case 'saveRoster': {
          const roster = [];
          String(d.text || '').split(/\r?\n/).forEach(line => {
            const c = line.split(/\t|,|，/).map(x => x.trim());
            if (c.length < 3 || /班級/.test(c[0])) return;
            const r = { cls: normCls(c[0]), seat: normSeat(c[1]), name: normCls(c[2]), email: normCls(c[3] || '').toLowerCase() };
            if (r.cls && r.seat && r.name) roster.push(r);
          });
          await writeJSON(ROSTER, roster);
          return json({ ok: true, count: roster.length });
        }

        case 'exportAll': {
          const rows = await loadAll();
          return json({ ok: true, rows: rows.map(({ key, s, p, t }) => ({ key, s, p, t })) });
        }
      }
      return json({ ok: false, msg: '不認得的動作。' });
    } catch (e) {
      console.error(e);
      return json({ ok: false, msg: '系統忙碌中，請稍後再試一次。' });
    }
  }
};
