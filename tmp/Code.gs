/**
 * 生活觀察解題室｜學生資料後台
 * 鳳新高中英文科李姬慧老師 X AI 彙整製作
 *
 * 這份程式綁在 Google 試算表上，負責接收學生在網站送出、自動同步的資料。
 * 會自動建立三個分頁：
 *   問題解決行動卡：每位學生一列，隨學生進度自動更新。
 *                   你可以填「老師建議」、選「目前關卡」，學生的網頁會顯示。
 *   進度回報：學生每週回報一列，你可以在「老師回覆」欄回覆。
 *   名單（選用）：班級、座號、姓名、學校帳號（選填）。有名單時，只有名單上的學生能送資料。
 */

// 班級代碼：學生建立身分時要輸入相同代碼
const ACCESS_CODE = '__ACCESS_CODE__';

// 學校帳號登入：填入 Google OAuth 用戶端 ID 後啟用；留空＝不檢查登入
const GOOGLE_LOGIN = { clientId: '', domain: 'fhsh.khc.edu.tw' };

const TZ = 'Asia/Taipei';
const MAIN_SHEET = '問題解決行動卡';
const PROG_SHEET = '進度回報';
const ROSTER_SHEET = '名單';
const GATES = ['待審', '需修改', '選題通過', '計畫通過', '期中通過', '完成'];

const COLUMNS = [
  ['time', '送出時間'], ['count', '送出次數'], ['cls', '班級'], ['seat', '座號'], ['name', '姓名'],
  ['fb', '老師建議'], ['fbAt', '建議時間'], ['gate', '目前關卡'], ['email', '學校帳號'],
  ['step', '目前進度'], ['syncAt', '最後更新'],
  ['observe', '觀察'], ['problem', '問題敘述'], ['root', '五個為什麼'], ['scale', '影響範圍'],
  ['option', '選定方案'], ['mine', '我的版本'], ['mvp', '第一版'], ['measure', '前後測量'], ['first', '這週第一件事'],
  ['resources', '我的條件'], ['result', '成果數據'], ['logs', '試做日誌'], ['reflect', '結論與反思'],
  ['full', '完整行動卡與成果'], ['backup', '進度碼（貼到網站可還原）']
];
const C = {};
COLUMNS.forEach(([k], i) => C[k] = i + 1);

const PROG_COLUMNS = ['回報時間', '班級', '座號', '姓名', '學校帳號', '週次', '本週完成', '下週計畫',
  '卡關的地方', '需要老師協助', '老師回覆', '要解決的問題', '進度碼'];
const P_REPLY = 11;  // 「老師回覆」在第 11 欄

// ===== 接收學生資料 =====
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); }
  catch (err) { return reply({ ok: false, msg: '資料格式錯誤，請重新整理頁面再試一次。' }); }

  if (ACCESS_CODE && String(d.code || '').trim() !== ACCESS_CODE) {
    return reply({ ok: false, msg: '班級代碼不正確，請向老師確認。' });
  }
  const cls = normCls(d.cls), seat = normSeat(d.seat), name = normCls(d.name);
  if (!cls || !seat || !name) return reply({ ok: false, msg: '請填寫班級、座號和姓名。' });

  // 學校帳號登入（有設定用戶端 ID 時）
  d.email = '';
  if (GOOGLE_LOGIN.clientId) {
    const g = verifyGoogle(d.idToken);
    if (g.err) return reply({ ok: false, msg: g.err, relogin: true });
    d.email = g.email;
  }
  // 全班名單（有「名單」分頁時）
  const err = checkRoster(cls, seat, name, d.email);
  if (err) return reply({ ok: false, msg: err });

  switch (d.action) {
    case 'verify':    return reply({ ok: true, roster: hasRoster() });
    case 'problem':   return saveMain(d, cls, seat, name, false);   // 學生按「送出」
    case 'sync':      return saveMain(d, cls, seat, name, true);    // 自動同步
    case 'problemFb': return getFeedback(cls, seat, name);
    case 'progress':  return saveProgress(d, cls, seat, name);
    case 'replies':   return getReplies(cls, seat, name);
  }
  return reply({ ok: false, msg: '不認得的動作。' });
}

// 用瀏覽器打開網址時顯示，方便確認部署成功
function doGet() {
  return ContentService.createTextOutput('生活觀察解題室後台運作中 ✓');
}

// ===== 問題解決行動卡 =====
function getMainSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(MAIN_SHEET);
  if (!sh) sh = ss.insertSheet(MAIN_SHEET, 0);
  if (sh.getLastRow() === 0) {
    const n = COLUMNS.length, rows = sh.getMaxRows();
    sh.appendRow(COLUMNS.map(c => c[1]));
    sh.setFrozenRows(1);
    sh.setFrozenColumns(5);
    sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#D97706').setFontColor('#FFFFFF');
    sh.getRange(1, C.fb, 1, 3).setBackground('#0F766E');
    sh.getRange(2, C.fb, rows - 1, 1).setBackground('#FDF0DC');
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(GATES, true).setAllowInvalid(false).build();
    sh.getRange(2, C.gate, rows - 1, 1).setDataValidation(rule).setBackground('#FDF0DC');
    sh.getRange('C:D').setNumberFormat('@');
    sh.getRange(1, C.time, rows, 1).setNumberFormat('yyyy/mm/dd hh:mm');
    sh.getRange(1, C.fbAt, rows, 1).setNumberFormat('yyyy/mm/dd hh:mm');
    sh.getRange(1, C.syncAt, rows, 1).setNumberFormat('yyyy/mm/dd hh:mm');
    sh.getRange(1, C.fb, rows, C.full - C.fb + 1).setWrap(true).setVerticalAlignment('top');
    sh.setColumnWidth(C.fb, 280);
    sh.setColumnWidth(C.step, 260);
    sh.setColumnWidths(C.observe, C.reflect - C.observe + 1, 220);
    sh.setColumnWidth(C.backup, 120);
  }
  return sh;
}

function findRow(sh, cls, seat) {
  const last = sh.getLastRow();
  if (last < 2) return null;
  const all = sh.getRange(2, 1, last - 1, COLUMNS.length).getValues();
  for (let i = 0; i < all.length; i++) {
    if (String(all[i][C.cls - 1]).trim() === cls && String(all[i][C.seat - 1]).trim() === seat) {
      return { row: i + 2, values: all[i] };
    }
  }
  return null;
}

function saveMain(d, cls, seat, name, isSync) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const sh = getMainSheet();
    const found = findRow(sh, cls, seat);
    const old = k => found ? found.values[C[k] - 1] : '';
    const prev = Number(old('count')) || 0;
    const count = isSync ? prev : prev + 1;   // 自動同步不增加「送出次數」
    const row = COLUMNS.map(([k]) => {
      switch (k) {
        case 'time':   return isSync ? old('time') : new Date();  // 只記手動送出的時間
        case 'count':  return count;
        case 'cls':    return cls;
        case 'seat':   return seat;
        case 'name':   return name;
        case 'fb':     return old('fb');                // 老師填的欄位一律保留
        case 'fbAt':   return old('fbAt');
        case 'gate':   return old('gate') || '待審';
        case 'email':  return d.email || old('email');
        case 'syncAt': return new Date();
        default:       return clean(d[k]);
      }
    });
    if (found) sh.getRange(found.row, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    return reply({ ok: true, msg: '已送出', count: count });
  } catch (err) {
    return reply({ ok: false, msg: '系統忙碌中，請稍後再試一次。（' + err + '）' });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function getFeedback(cls, seat, name) {
  const found = findRow(getMainSheet(), cls, seat);
  if (!found) return reply({ ok: false, msg: '還找不到你的資料，請先送出或等自動同步。' });
  if (String(found.values[C.name - 1]).trim() !== name) {
    return reply({ ok: false, msg: '姓名和送出時填的不一樣，請檢查。' });
  }
  const at = found.values[C.fbAt - 1];
  return reply({
    ok: true,
    feedback: String(found.values[C.fb - 1] || '').trim(),
    gate: String(found.values[C.gate - 1] || '').trim(),
    at: at instanceof Date ? Utilities.formatDate(at, TZ, 'yyyy/MM/dd HH:mm') : String(at || '')
  });
}

// ===== 進度回報 =====
function getProgSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PROG_SHEET);
  if (!sh) sh = ss.insertSheet(PROG_SHEET);
  if (sh.getLastRow() === 0) {
    const rows = sh.getMaxRows();
    sh.appendRow(PROG_COLUMNS);
    sh.setFrozenRows(1);
    sh.setFrozenColumns(4);
    sh.getRange(1, 1, 1, PROG_COLUMNS.length).setFontWeight('bold').setBackground('#D97706').setFontColor('#FFFFFF');
    sh.getRange(1, P_REPLY).setBackground('#0F766E');
    sh.getRange(2, P_REPLY, rows - 1, 1).setBackground('#FDF0DC');
    sh.getRange('B:C').setNumberFormat('@');
    sh.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
    sh.getRange(1, 7, rows, 6).setWrap(true).setVerticalAlignment('top');
    sh.setColumnWidths(7, 3, 220);
    sh.setColumnWidth(P_REPLY, 260);
  }
  return sh;
}

function saveProgress(d, cls, seat, name) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    getProgSheet().appendRow([new Date(), cls, seat, name, d.email || '', clean(d.week), clean(d.done), clean(d.next),
      clean(d.stuck), clean(d.help), '', clean(d.rq), clean(d.backup)]);
    return reply({ ok: true, msg: '已送出' });
  } catch (err) {
    return reply({ ok: false, msg: '系統忙碌中，請稍後再試一次。（' + err + '）' });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function getReplies(cls, seat, name) {
  const sh = getProgSheet(), last = sh.getLastRow(), out = [];
  if (last > 1) {
    sh.getRange(2, 1, last - 1, PROG_COLUMNS.length).getValues().forEach(r => {
      if (String(r[1]).trim() === cls && String(r[2]).trim() === seat && String(r[3]).trim() === name) {
        out.push({
          at: r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy/MM/dd HH:mm') : String(r[0]),
          week: String(r[5]),
          reply: String(r[P_REPLY - 1] || '').trim()
        });
      }
    });
  }
  return reply({ ok: true, replies: out });
}

// ===== 全班名單 =====
function getRosterSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ROSTER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ROSTER_SHEET);
    sh.appendRow(['班級', '座號', '姓名', '學校帳號（選填）']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#D97706').setFontColor('#FFFFFF');
    sh.getRange('A:B').setNumberFormat('@');
    sh.setColumnWidth(4, 260);
  }
  return sh;
}

function rosterRows() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .map(r => ({ cls: normCls(r[0]), seat: normSeat(r[1]), name: normCls(r[2]), email: normCls(r[3]).toLowerCase() }))
    .filter(r => r.cls && r.seat);
}
function hasRoster() { return rosterRows().length > 0; }

// 回傳錯誤訊息；沒問題回傳空字串
function checkRoster(cls, seat, name, email) {
  const rows = rosterRows();
  if (!rows.length) return '';
  const hit = rows.find(r => r.cls === cls && r.seat === seat);
  if (!hit) return '名單裡找不到「' + cls + ' 班 ' + seat + ' 號」，請檢查班級和座號。';
  if (hit.name !== name) return '這個座號在名單上的姓名不是「' + name + '」，請檢查姓名有沒有打錯。';
  if (hit.email && email && hit.email !== String(email).toLowerCase()) {
    return '這個座號登記的學校帳號，和你現在登入的帳號不同。請用自己的帳號登入，或請老師確認名單。';
  }
  return '';
}

// ===== 學校帳號驗證 =====
function verifyGoogle(token) {
  if (!token) return { err: '請先用學校帳號登入。' };
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return { email: hit };
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { err: '登入已經過期，請重新登入後再試一次。' };
  const t = JSON.parse(res.getContentText());
  if (t.aud !== GOOGLE_LOGIN.clientId) return { err: '登入資訊不正確，請重新登入。' };
  const email = String(t.email || '').toLowerCase();
  if (t.hd !== GOOGLE_LOGIN.domain || String(t.email_verified) !== 'true' || !email.endsWith('@' + GOOGLE_LOGIN.domain)) {
    return { err: '只限 @' + GOOGLE_LOGIN.domain + ' 學校帳號使用。' };
  }
  if (Number(t.exp) * 1000 < Date.now()) return { err: '登入已經過期，請重新登入後再試一次。' };
  cache.put(key, email, 300);
  return { email: email };
}

// ===== 老師在「老師建議」欄打字時，自動記下時間 =====
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== MAIN_SHEET) return;
  if (e.range.getRow() < 2 || e.range.getColumn() > C.fb || e.range.getLastColumn() < C.fb) return;
  for (let r = e.range.getRow(); r <= e.range.getLastRow(); r++) {
    const v = sh.getRange(r, C.fb).getValue();
    sh.getRange(r, C.fbAt).setValue(String(v).trim() ? new Date() : '');
  }
}

// ===== 試算表上方的「自主學習」選單 =====
function onOpen() {
  SpreadsheetApp.getUi().createMenu('自主學習')
    .addItem('建立全部分頁', 'setupSheets')
    .addItem('依班級、座號排序', 'sortByClassSeat')
    .addToUi();
}

function setupSheets() {
  getMainSheet();
  getProgSheet();
  getRosterSheet();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const blank = ss.getSheets().find(s => /^(工作表|Sheet)\d+$/.test(s.getName()) && s.getLastRow() === 0);
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

function sortByClassSeat() {
  const sh = getMainSheet(), last = sh.getLastRow();
  if (last < 3) return;
  const range = sh.getRange(2, 1, last - 1, COLUMNS.length);
  const data = range.getValues();
  data.sort((a, b) =>
    String(a[C.cls - 1]).localeCompare(String(b[C.cls - 1]), 'zh-TW', { numeric: true }) ||
    (Number(a[C.seat - 1]) || 0) - (Number(b[C.seat - 1]) || 0));
  range.setValues(data);
}

// ===== 小工具 =====
function normCls(v) {
  return String(v == null ? '' : v)
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '').slice(0, 40);
}
function normSeat(v) {
  const t = normCls(v);
  return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t;
}
// 去除空白、限制長度，並避免內容被試算表當成公式
function clean(v) {
  let s = String(v == null ? '' : v).trim().slice(0, 45000);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
