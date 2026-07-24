/**
 * 瑛斗・颯斗 選手カルテ バックエンド（単一Apps Script + 単一スプレッドシート版）
 *
 * MIC選手育成の「選手カルテ」システム（GitHub Pages + 複数のApps Script + 複数スプレッドシート）
 * を参考に、瑛斗・颯斗の2名向けに簡略化したもの。
 * 5つの別々のWeb Appに分けず、1つのWeb Appで type パラメータによりルーティングする。
 *
 * ------------------------------------------------------------
 * 前提となるスプレッドシートのタブ構成（このスクリプトはスプレッドシートに
 * 「コンテナバインドスクリプト」として紐づけること。 拡張機能 > Apps Script）
 * ------------------------------------------------------------
 *
 * ■ 名簿   （ヘッダー行）: token | 名前 | 有効
 *   例: e8e183033ebb85ca4dfaf8b8 | 瑛斗 | TRUE
 *       ada5cb88c3ea6391860c3813 | 颯斗 | TRUE
 *
 * ■ シーズン目標  （ヘッダー行）: 名前 | 目標 | 期限 | 更新日
 *   1名につき1行。Vanさんが直接編集する想定（フォームは無し）。
 *
 * ■ マンダラ  （ヘッダー行）: 名前 | データJSON | 更新日
 *   「データJSON」列に {"center":"...", "subGoals":[{"title":"...","actions":["",... x8]}, ... x8]} を保存する。
 *   1名につき1行。空文字なら未入力として扱う。
 *
 * ■ 短期目標  （ヘッダー行）: タイムスタンプ | 名前 | 振り返り | 新しい目標 | 挑戦したい技
 *   1名につき複数行（月次で増えていく）。将来Googleフォームの回答先をこのタブにしても良い
 *   （その場合はフォームの質問文とこのヘッダーの対応関係を doc/デプロイ手順.md 参照）。
 *   最新の行（タイムスタンプ最大）をそのまま「現在の短期目標」として返す。
 *
 * ■ 技記録ログ  （ヘッダー行）: id | タイムスタンプ | 名前 | 技 | 本数 | 成功数 | メモ | 動画URL
 *   カルテ画面から選手本人が追加する（POST）。
 *
 * ■ コーチメモ  （ヘッダー行）: id | タイムスタンプ | 名前 | 発信者 | 本文
 *   発信者は "本人" または "コーチ"。カルテ画面から追加する（POST）。
 *
 * ------------------------------------------------------------
 * デプロイ: 拡張機能 > Apps Script > 右上「デプロイ」>「新しいデプロイ」
 *   種類: ウェブアプリ / 実行ユーザー: 自分 / アクセスできるユーザー: 全員
 *   発行されたURL（.../exec）を karte/index.html の API_URL に設定する。
 */

var SHEET_ROSTER = '名簿';
var SHEET_SEASON = 'シーズン目標';
var SHEET_MANDALA = 'マンダラ';
var SHEET_STG = '短期目標';
var SHEET_AIRLOG = '技記録ログ';
var SHEET_COACHNOTES = 'コーチメモ';

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」が見つかりません。スプレッドシートのタブ名を確認してください。');
  return sh;
}

// シートの内容をヘッダー行をキーにしたオブジェクトの配列にして返す
function readRows_(name) {
  var sh = getSheet_(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 1) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var blank = row.every(function (c) { return c === '' || c === null; });
    if (blank) continue;
    var obj = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    rows.push(obj);
  }
  return rows;
}

function appendRow_(name, obj, headers) {
  var sh = getSheet_(name);
  var row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(row);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function findAthleteNameByToken_(token) {
  if (!token) return null;
  var rows = readRows_(SHEET_ROSTER);
  for (var i = 0; i < rows.length; i++) {
    var enabled = rows[i]['有効'];
    var isEnabled = (enabled === true || enabled === 'TRUE' || enabled === 'true' || enabled === 1 || enabled === '');
    if (String(rows[i]['token']) === String(token) && isEnabled) {
      return rows[i]['名前'];
    }
  }
  return null;
}

function uid_(prefix) {
  return (prefix || 'e_') + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

// ---------------- GET ----------------

function doGet(e) {
  var type = (e.parameter.type || '').toString();
  try {
    if (type === 'resolver') return jsonOut_(handleResolver_(e));
    if (type === 'season') return jsonOut_(handleSeason_(e));
    if (type === 'mandala') return jsonOut_(handleMandala_(e));
    if (type === 'stg') return jsonOut_(handleStg_(e));
    if (type === 'airlog') return jsonOut_(handleAirlogGet_(e));
    if (type === 'coachnotes') return jsonOut_(handleCoachNotesGet_(e));
    return jsonOut_({ error: '不明なtypeパラメータです: ' + type });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function handleResolver_(e) {
  if (e.parameter.list === 'athletes') {
    var rows = readRows_(SHEET_ROSTER).filter(function (r) {
      var enabled = r['有効'];
      return (enabled === true || enabled === 'TRUE' || enabled === 'true' || enabled === 1 || enabled === '');
    });
    return { athletes: rows.map(function (r) { return { name: r['名前'], token: r['token'] }; }) };
  }
  var token = e.parameter.token;
  var name = findAthleteNameByToken_(token);
  if (!name) return { error: 'invalid_token' };
  return { name: name, token: token };
}

function handleSeason_(e) {
  var name = findAthleteNameByToken_(e.parameter.token);
  if (!name) return { error: 'invalid_token' };
  var rows = readRows_(SHEET_SEASON).filter(function (r) { return r['名前'] === name; });
  if (!rows.length) return { name: name, goal: null, deadline: null, updatedAt: null };
  var r = rows[rows.length - 1];
  return { name: name, goal: r['目標'] || null, deadline: r['期限'] || null, updatedAt: r['更新日'] || null };
}

function handleMandala_(e) {
  var name = findAthleteNameByToken_(e.parameter.token);
  if (!name) return { error: 'invalid_token' };
  var rows = readRows_(SHEET_MANDALA).filter(function (r) { return r['名前'] === name; });
  if (!rows.length || !rows[rows.length - 1]['データJSON']) {
    return { name: name, center: null, subGoals: null, updatedAt: null };
  }
  var r = rows[rows.length - 1];
  var data;
  try {
    data = JSON.parse(r['データJSON']);
  } catch (err) {
    return { name: name, center: null, subGoals: null, updatedAt: null, error: 'マンダラJSONの解析に失敗しました' };
  }
  return { name: name, center: data.center || null, subGoals: data.subGoals || null, updatedAt: r['更新日'] || null };
}

function handleStg_(e) {
  var name = findAthleteNameByToken_(e.parameter.token);
  if (!name) return { error: 'invalid_token' };
  var rows = readRows_(SHEET_STG).filter(function (r) { return r['名前'] === name; });
  if (!rows.length) return { name: name, entry: null };
  rows.sort(function (a, b) {
    return new Date(a['タイムスタンプ']).getTime() - new Date(b['タイムスタンプ']).getTime();
  });
  var latest = rows[rows.length - 1];
  return {
    name: name,
    entry: {
      timestamp: latest['タイムスタンプ'] || null,
      reflection: latest['振り返り'] || null,
      newGoal: latest['新しい目標'] || null,
      wantToTry: latest['挑戦したい技'] || null
    }
  };
}

function handleAirlogGet_(e) {
  var name = findAthleteNameByToken_(e.parameter.token);
  if (!name) return { error: 'invalid_token' };
  var rows = readRows_(SHEET_AIRLOG).filter(function (r) { return r['名前'] === name; });
  rows.sort(function (a, b) {
    return new Date(b['タイムスタンプ']).getTime() - new Date(a['タイムスタンプ']).getTime();
  });
  var records = rows.slice(0, 100).map(function (r) {
    return {
      id: r['id'],
      timestamp: r['タイムスタンプ'],
      technique: r['技'],
      reps: r['本数'],
      success: r['成功数'],
      memo: r['メモ'] || '',
      videoUrl: r['動画URL'] || ''
    };
  });
  return { name: name, records: records };
}

function handleCoachNotesGet_(e) {
  var name = findAthleteNameByToken_(e.parameter.token);
  if (!name) return { error: 'invalid_token' };
  var rows = readRows_(SHEET_COACHNOTES).filter(function (r) { return r['名前'] === name; });
  rows.sort(function (a, b) {
    return new Date(a['タイムスタンプ']).getTime() - new Date(b['タイムスタンプ']).getTime();
  });
  var notes = rows.map(function (r) {
    return { id: r['id'], timestamp: r['タイムスタンプ'], sender: r['発信者'], text: r['本文'] };
  });
  return { name: name, notes: notes };
}

// ---------------- POST ----------------

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var type = body.type;
    if (type === 'addAirlog') return jsonOut_(handleAirlogAdd_(body));
    if (type === 'addCoachNote') return jsonOut_(handleCoachNoteAdd_(body));
    return jsonOut_({ error: '不明なtypeです: ' + type });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function handleAirlogAdd_(body) {
  var name = findAthleteNameByToken_(body.token);
  if (!name) return { error: 'invalid_token' };
  var row = {
    'id': uid_('a_'),
    'タイムスタンプ': new Date(),
    '名前': name,
    '技': body.technique || '',
    '本数': body.reps || '',
    '成功数': body.success || '',
    'メモ': body.memo || '',
    '動画URL': body.videoUrl || ''
  };
  appendRow_(SHEET_AIRLOG, row, ['id', 'タイムスタンプ', '名前', '技', '本数', '成功数', 'メモ', '動画URL']);
  return { ok: true };
}

function handleCoachNoteAdd_(body) {
  var name = findAthleteNameByToken_(body.token);
  if (!name) return { error: 'invalid_token' };
  var sender = body.sender === 'coach' ? 'コーチ' : '本人';
  var row = {
    'id': uid_('n_'),
    'タイムスタンプ': new Date(),
    '名前': name,
    '発信者': sender,
    '本文': body.text || ''
  };
  appendRow_(SHEET_COACHNOTES, row, ['id', 'タイムスタンプ', '名前', '発信者', '本文']);
  return { ok: true };
}
