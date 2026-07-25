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
 * ■ 名簿   （ヘッダー行）: token | 名前 | 有効 | マンダラシートURL
 *   例: e8e183033ebb85ca4dfaf8b8 | 瑛斗 | TRUE | https://docs.google.com/spreadsheets/d/xxxx/edit
 *       ada5cb88c3ea6391860c3813 | 颯斗 | TRUE | https://docs.google.com/spreadsheets/d/yyyy/edit
 *   「マンダラシートURL」は、MICの「マンダラチャート（選手名）」スプレッドシートを選手ごとに
 *   コピーして作った個別シートのURL。この列を見て、どのシートを読みに行くか判断する。
 *
 * ■ シーズン目標 = MICの「目標設定シート」Googleフォームを瑛斗颯斗用にコピーしたものの回答シート
 *   （このスプレッドシート内のタブではなく、SEASON_FORM_SS_ID で指定する別スプレッドシート
 *   「瑛斗颯斗 目標設定シート（回答）」の「フォームの回答 1」タブを直接読みに行く）。
 *   名前列で絞り込み、最新（一番下）の回答を「現在のシーズン目標」として返す。
 *
 * ■ マンダラ = 名簿の「マンダラシートURL」で指定された、選手ごとの個別マンダラスプレッドシート
 *   （MICと同じ「マンダラチャート(記入用)」タブ、9x9マスのA1:I9をそのまま読み取って返す。
 *   選手やVanさんがそのスプレッドシートを直接開いて手入力する想定。このApps Scriptは読み取り専用）。
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
 *   コードを更新した場合は「デプロイを管理」>編集(鉛筆)>「新しいバージョン」で再デプロイすること。
 */

var SHEET_ROSTER = '名簿';
var SHEET_STG = '短期目標';
var SHEET_AIRLOG = '技記録ログ';
var SHEET_COACHNOTES = 'コーチメモ';

// MICの「目標設定シート」Googleフォームを瑛斗颯斗用にコピーした際の回答スプレッドシートID
var SEASON_FORM_SS_ID = '1Xezq36_rQNOXxralFgeWdJTL7bpA_wLtFqSFCgBt3kc';
var MANDALA_SHEET_TAB = 'マンダラチャート(記入用)';

// 自己分析（5段階評価）の項目名（フォームの質問見出しの「先頭一致」で列を特定する）
var SEASON_SELF_RATING_LABELS = [
  '宙返り技術', 'ひねり技術', '高さ・跳躍力', '精密性',
  '体力', '筋力', '柔軟性', 'メンタル', '練習への取り組み', '自主性', 'コミュニケーション', 'コンディショニング'
];
// 今年の目標（6カテゴリ）
var SEASON_GOAL_LABELS = [
  ['成績', '今年達成したい大会成績'],
  ['技術', '今年伸ばしたい技術'],
  ['フィジカル', '今年伸ばしたい身体能力'],
  ['メンタル', '今年強くしたいこと'],
  ['学校生活', '学校で頑張りたいこと'],
  ['人間性', '競技以外で成長したいこと']
];
// 将来の目標（MICの「将来ビジョン」カードに相当）
var SEASON_VISION_LABELS = {
  goal: '3〜5年後',
  reason: 'その理由を教えて',
  ultimate: '競技を長く続けた先の',
  needed: 'その目標を達成するために必要な',
  selfFeeling: 'その目標を達成できたとき',
  othersFeeling: 'その目標を達成することで'
};
// 生活習慣（4項目）
var SEASON_LIFE_LABELS = [
  ['平均睡眠時間', '平均睡眠時間'],
  ['朝食', '朝食'],
  ['自主トレ', '自主トレ'],
  ['スマホ・ゲーム', 'スマホ・ゲーム']
];
// サポートについて
var SEASON_SUPPORT_LABELS = {
  coachRequest: 'コーチに教えてほしい',
  worry: '今、不安な',
  toParents: '保護者やコーチに伝えたい'
};
// 最後に（大切にしたい言葉・自分へのメッセージ）
var SEASON_FINAL_LABELS = {
  importantWord: '今年一番大切にしたい言葉',
  message: '最後に、今年の自分へのメッセージ'
};
// 競技について（これまでフォームには回答があるのにAPI・画面のどちらにも出ていなかった項目、2026-07-25追加）
var SEASON_ABOUT_LABELS = {
  startedWhen: 'トランポリンはいつから始めましたか',
  reasonStarted: 'トランポリンを始めたきっかけ',
  favoritePart: 'トランポリンのどんなところが好き',
  respectedAthlete: '尊敬している選手',
  strength: 'あなたの強みは何',
  challenge: '今、一番の課題は何'
};

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

// ヘッダー名の「先頭一致」で列インデックス(0始まり)を探す。無ければ-1。
function findColByPrefix_(headers, prefix) {
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).indexOf(prefix) === 0) return i;
  }
  return -1;
}

// 任意のSheetオブジェクトを、ヘッダー行をキーにしたオブジェクトの配列にして返す
function readRowsFromSheet_(sh) {
  var values = sh.getDataRange().getValues();
  if (values.length < 1) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var blank = row.every(function (c) { return c === '' || c === null; });
    if (blank) continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = row[j];
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function handleSeason_(e) {
  var name = findAthleteNameByToken_(e.parameter.token);
  if (!name) return { error: 'invalid_token' };
  var ss = SpreadsheetApp.openById(SEASON_FORM_SS_ID);
  var sh = ss.getSheets()[0]; // フォームの回答が入る最初のタブ
  var parsed = readRowsFromSheet_(sh);
  var headers = parsed.headers;
  var rows = parsed.rows.filter(function (r) { return r['名前'] === name; });
  if (!rows.length) return { name: name, hasEntry: false };
  var r = rows[rows.length - 1]; // 最新の回答

  var goals = {};
  SEASON_GOAL_LABELS.forEach(function (pair) {
    var key = pair[0], prefix = pair[1];
    var col = findColByPrefix_(headers, prefix);
    goals[key] = col >= 0 ? (r[headers[col]] || null) : null;
  });

  var selfRatings = SEASON_SELF_RATING_LABELS.map(function (label) {
    var col = findColByPrefix_(headers, label);
    var val = col >= 0 ? r[headers[col]] : null;
    return { label: label, score: val === '' || val === null || val === undefined ? null : Number(val) };
  });

  var topCol = findColByPrefix_(headers, '上記');
  var topTwo = topCol >= 0 && r[headers[topCol]] ? String(r[headers[topCol]]).split(',').map(function (s) { return s.trim(); }) : [];

  function pickByPrefix(prefix) {
    var col = findColByPrefix_(headers, prefix);
    return col >= 0 ? (r[headers[col]] || null) : null;
  }
  var competitionPlans = {
    thisSeasonRule: pickByPrefix('今シーズン大会で使う予定の演技(規定演技)'),
    thisSeasonFree: pickByPrefix('今シーズン大会で使う予定の演技(自由演技)'),
    nextSeasonRule: pickByPrefix('来シーズン大会で使う予定の演技(規定演技)'),
    nextSeasonFree: pickByPrefix('来シーズン大会で使う予定の演技(自由演技)')
  };

  var vision = {
    goal: pickByPrefix(SEASON_VISION_LABELS.goal),
    reason: pickByPrefix(SEASON_VISION_LABELS.reason),
    ultimate: pickByPrefix(SEASON_VISION_LABELS.ultimate),
    needed: pickByPrefix(SEASON_VISION_LABELS.needed),
    selfFeeling: pickByPrefix(SEASON_VISION_LABELS.selfFeeling),
    othersFeeling: pickByPrefix(SEASON_VISION_LABELS.othersFeeling)
  };
  var hasVision = vision.goal || vision.ultimate;

  var about = {
    startedWhen: pickByPrefix(SEASON_ABOUT_LABELS.startedWhen),
    reasonStarted: pickByPrefix(SEASON_ABOUT_LABELS.reasonStarted),
    favoritePart: pickByPrefix(SEASON_ABOUT_LABELS.favoritePart),
    respectedAthlete: pickByPrefix(SEASON_ABOUT_LABELS.respectedAthlete),
    strength: pickByPrefix(SEASON_ABOUT_LABELS.strength),
    challenge: pickByPrefix(SEASON_ABOUT_LABELS.challenge)
  };
  var hasAbout = about.startedWhen || about.reasonStarted || about.favoritePart || about.respectedAthlete || about.strength || about.challenge;

  var life = {};
  SEASON_LIFE_LABELS.forEach(function (pair) {
    var key = pair[0], prefix = pair[1];
    var v = pickByPrefix(prefix);
    if (v) life[key] = v;
  });
  var hasLife = Object.keys(life).length > 0;

  var support = {
    coachRequest: pickByPrefix(SEASON_SUPPORT_LABELS.coachRequest),
    worry: pickByPrefix(SEASON_SUPPORT_LABELS.worry),
    toParents: pickByPrefix(SEASON_SUPPORT_LABELS.toParents)
  };
  var hasSupport = support.coachRequest || support.worry || support.toParents;

  var importantWord = pickByPrefix(SEASON_FINAL_LABELS.importantWord);
  var finalMessage = pickByPrefix(SEASON_FINAL_LABELS.message);

  return {
    name: name,
    hasEntry: true,
    timestamp: r['タイムスタンプ'] || null,
    goals: goals,
    selfRatings: selfRatings,
    topTwo: topTwo,
    competitionPlans: competitionPlans,
    vision: hasVision ? vision : null,
    about: hasAbout ? about : null,
    life: hasLife ? life : null,
    support: hasSupport ? support : null,
    importantWord: importantWord,
    finalMessage: finalMessage
  };
}

function handleMandala_(e) {
  var name = findAthleteNameByToken_(e.parameter.token);
  if (!name) return { error: 'invalid_token' };
  var rosterRows = readRows_(SHEET_ROSTER);
  var athleteRow = rosterRows.filter(function (r) { return r['名前'] === name; })[0];
  var url = athleteRow && athleteRow['マンダラシートURL'];
  if (!url) return { name: name, grid: null, editUrl: null };

  var mandalaSs;
  try {
    mandalaSs = SpreadsheetApp.openByUrl(url);
  } catch (err) {
    return { name: name, grid: null, editUrl: url, error: 'マンダラシートを開けませんでした: ' + err };
  }
  var sh = mandalaSs.getSheetByName(MANDALA_SHEET_TAB);
  if (!sh) return { name: name, grid: null, editUrl: url, error: 'マンダラシートのタブ「' + MANDALA_SHEET_TAB + '」が見つかりません' };

  var grid = sh.getRange(1, 1, 9, 9).getValues();
  var hasContent = grid.some(function (row) { return row.some(function (c) { return c !== '' && c !== null; }); });

  var updatedAt = null;
  try {
    var m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (m) updatedAt = DriveApp.getFileById(m[1]).getLastUpdated();
  } catch (err2) { /* 取得できなければ無視 */ }

  return { name: name, grid: hasContent ? grid : null, editUrl: url, updatedAt: updatedAt };
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
