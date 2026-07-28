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

// 大会振り返りフォーム（回答スプレッドシート、フォーム改修後の新しいID・2026-07-27〜）
var TAIKAI_FORM_SS_ID = '1Ypd5JbRQyWDiKXMDWFR5VQwut71QCCwWEsnQhC2jc00';
// 質問見出しの「先頭一致」で列を特定する（大会振り返りフォーム）
var TAIKAI_LABELS = {
  meetName: '大会名',
  meetDate: '日付',
  events: '出場した種目',
  kojinRank: '個人競技の順位',
  kojinScore: '個人競技の点数',
  kojinFeeling: '今日の演技はどうだった',
  kojinResultScore: '今日の「結果」には',
  kojinContentScore: '今日の「演技内容」には',
  kojinScoreReason: 'その点数をつけた',
  kojinGoodThing: '今日、一番よかったこと',
  kojinGoodReason: 'それができたのは',
  kojinImprove: '一番悔しかったこと',
  kojinPracticePlan: 'そのために、どんなことを意識',
  kojinCoachHelp: 'コーチに手伝ってほしいことは',
  kojinPainFear: '痛み・怖さ・困ったことはあった',
  kojinPainFearDetail: '具体的にどんなことがあった',
  syncRank: 'シンクロ競技の順位',
  syncScore: 'シンクロ競技の点数',
  syncTiming: 'ペアとのタイミングはどうだった',
  syncTimingCause: 'タイミングがずれたとしたら',
  syncGoodThing: 'シンクロで一番うまくできたこと',
  nextFunScope: '次の大会や練習で楽しみにしていることは',
  nextFunText: '（具体的に）',
  selfWord: '今日の自分にひとこと',
  // 2026-07-28のフォーム改修で追加した3問（回答シートでは右端28〜30列に付く）。
  // 既存行（2026-07-26）は改修前の回答なので空欄のまま。空欄は「未回答」として静かに畳む。
  kojinGoalAchieved: '大会前に決めていた目標は',
  kojinScoreFocus: 'その点数をつけるとき',   // 「その点数をつけた一番大きな理由は？」とは先頭が異なるので衝突しない
  kojinMainIssue: 'どこが一番課題だったと思う'
};

// 大会公式リザルト（sporttech.io からの転記。回答スプレッドシート内の別タブ）
// フォームの回答列に手動列を混ぜると壊れやすいため別タブにしている。
var TAIKAI_RESULT_SHEET = '大会公式リザルト';
// 得点内訳の満点。出典は FIG Code of Points 2025-2028（Trampoline Gymnastics, Part I）。
//   §17.2.9.1 個人：   Score = E(max 20) + H(max 10) + D + T − P
//   §17.2.9.2 シンクロ：Score = E(max 10) + H(max 10) + S(max 20) + D − P
//  E … 減点方式。個人は20点満点（§17.2.3.2）、シンクロは10点満点（§17.2.3.3）。
//  H … 10点満点からの減点方式（§17.2.4.2）。
//  S（同時性）… 10点満点から減点し、その値を2倍したものがスコア（§17.2.6.2）。つまり満点は20点。
//      実データ 18.6（= (10 − 0.7) × 2）とも一致する。
//  D … 加点方式で上限なし（難しい技を入れるほど上がる）。
//  T … 跳躍時間そのもの（1秒1点）で上限なし。
// 注意：§15.4 により、演技が中断された場合などは CJP が有効種目数を決め、E・H・S の満点が
// これより小さくなることがある。10種目を完遂した通常の演技ではこの値でよい。
var TAIKAI_RESULT_MAX = { E_kojin: 20, E_sync: 10, H: 10, S: 20 };
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
    if (type === 'taikai') return jsonOut_(handleTaikaiGet_(e));
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

// 大会名の表記ゆれを吸収して突き合わせキーにする。
// 手入力時にタブ文字や前後の空白が混入した実例があり、見た目では気付けないまま文字列照合だけが
// 一致しなくなるため、空白類（半角・全角・タブ）をすべて除いたものをキーにする。
function meetKey_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\s　]/g, '');
}

// 日付の表記ゆれを YYYY-MM-DD に正規化する（表示用。突き合わせには使わない）。
// 回答シートは 2026/07/26（スラッシュ、Date型になることもある）、大会公式リザルトタブは
// 2026-07-26（ハイフン・テキスト固定）。テキスト固定はDate型への自動変換でデータが壊れる不具合を
// このプロジェクト群で実際に踏んだための対策なので、リザルト側をDate型に直してはいけない。
// 予選と決勝が別日開催になる大会があるため、突き合わせに日付は使わない（名前＋大会名で行う）。
function normalizeDate_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = s.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (!m) return null;
  function pad(n) { return (n.length === 1 ? '0' : '') + n; }
  return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
}

// 順位の表記ゆれを数値にする。既存行は「7位」「10位」、フォーム経由の新規入力は数値のみ。
// TEXTの自由入力なので、数字以外が混ざっていても数値部分だけを取り出す。
function normalizeRank_(v) {
  if (v === null || v === undefined || v === '') return null;
  var m = String(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

function numOrNull_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// 大会公式リザルトタブを読み、選手名で絞って正規化した配列を返す。
// タブが存在しない場合も落とさず空配列を返す（カルテ全体が読めなくなるのを避けるため）。
function readTaikaiResults_(ss, name) {
  var sh = ss.getSheetByName(TAIKAI_RESULT_SHEET);
  if (!sh) return [];
  var parsed = readRowsFromSheet_(sh);
  return parsed.rows
    .filter(function (r) { return String(r['名前']).trim() === name; })
    .map(function (r) {
      var event = String(r['種目'] || '').trim();
      var isSync = event.indexOf('シンクロ') >= 0;
      return {
        id: r['id'] || null,
        meetName: r['大会名'] || null,
        meetKey: meetKey_(r['大会名']),
        meetDate: normalizeDate_(r['日付']),
        event: event,                       // 個人 / シンクロ
        round: String(r['ラウンド'] || '').trim() || null,  // 予選 / 決勝
        rank: normalizeRank_(r['順位']),
        total: numOrNull_(r['総得点']),
        // L は実施減点の一部で、すでに E に含まれている（E = 満点 −(S1〜S10合計 + L)/10）。
        // 総得点から別途引くと二重減点になるので、記録するだけで計算には使わない。
        E: numOrNull_(r['E']),
        EMax: isSync ? TAIKAI_RESULT_MAX.E_sync : TAIKAI_RESULT_MAX.E_kojin,
        D: numOrNull_(r['D']),
        H: numOrNull_(r['H']),
        HMax: TAIKAI_RESULT_MAX.H,
        T: isSync ? null : numOrNull_(r['T']),          // T と Synchro は別列。個人行はSynchro空欄、
        synchro: isSync ? numOrNull_(r['Synchro']) : null, // シンクロ行はT空欄。1列に兼用しない。
        synchroMax: isSync ? TAIKAI_RESULT_MAX.S : null,
        L: numOrNull_(r['L']),
        P: numOrNull_(r['P']),
        sourceUrl: r['ソースURL'] || null
      };
    });
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

  // 昨年比較用：同一選手の1つ前の年度の回答（複数回答が年度ごとに1行たまる想定）
  var previousSelfRatings = null;
  if (rows.length >= 2) {
    var prevR = rows[rows.length - 2];
    previousSelfRatings = SEASON_SELF_RATING_LABELS.map(function (label) {
      var col = findColByPrefix_(headers, label);
      var val = col >= 0 ? prevR[headers[col]] : null;
      return { label: label, score: val === '' || val === null || val === undefined ? null : Number(val) };
    });
  }

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
    previousSelfRatings: previousSelfRatings,
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

// 大会振り返り（新フォーム回答シート、選手ごとに新しい順の配列で返す）
function handleTaikaiGet_(e) {
  var name = findAthleteNameByToken_(e.parameter.token);
  if (!name) return { error: 'invalid_token' };
  var ss = SpreadsheetApp.openById(TAIKAI_FORM_SS_ID);
  var sh = ss.getSheets()[0]; // フォームの回答が入る最初のタブ
  var parsed = readRowsFromSheet_(sh);
  var headers = parsed.headers;
  var rows = parsed.rows.filter(function (r) { return r['名前'] === name; });

  function pick(r, prefix) {
    var col = findColByPrefix_(headers, prefix);
    if (col < 0) return null;
    var v = r[headers[col]];
    return (v === '' || v === null || v === undefined) ? null : v;
  }
  function pickNum(r, prefix) {
    var v = pick(r, prefix);
    return v === null ? null : Number(v);
  }

  // 大会公式リザルト（E/D/H/T の得点内訳）。大会ごとの行として持ち、日付で振り返り行に結び付ける。
  // 推移表示へ切り替えるときに描画だけを変えれば済むよう、レコード側にも配列のまま持たせる。
  var allResults = readTaikaiResults_(ss, name);

  var records = rows.map(function (r) {
    var events = pick(r, TAIKAI_LABELS.events) || '';
    var hasKojin = events !== 'シンクロのみ';
    var hasSync = events !== '個人のみ';

    var kojin = hasKojin ? {
      rank: pick(r, TAIKAI_LABELS.kojinRank),
      score: pickNum(r, TAIKAI_LABELS.kojinScore),
      feeling: pick(r, TAIKAI_LABELS.kojinFeeling),
      resultScore: pickNum(r, TAIKAI_LABELS.kojinResultScore),
      contentScore: pickNum(r, TAIKAI_LABELS.kojinContentScore),
      scoreReason: pick(r, TAIKAI_LABELS.kojinScoreReason),
      goodThing: pick(r, TAIKAI_LABELS.kojinGoodThing),
      goodReason: pick(r, TAIKAI_LABELS.kojinGoodReason),
      improve: pick(r, TAIKAI_LABELS.kojinImprove),
      practicePlan: pick(r, TAIKAI_LABELS.kojinPracticePlan),
      coachHelp: pick(r, TAIKAI_LABELS.kojinCoachHelp),
      painFear: pick(r, TAIKAI_LABELS.kojinPainFear),
      painFearDetail: pick(r, TAIKAI_LABELS.kojinPainFearDetail),
      // 2026-07-28追加の3問。改修前の回答行では null になる（画面側で静かに畳む）。
      goalAchieved: pick(r, TAIKAI_LABELS.kojinGoalAchieved),
      scoreFocus: pick(r, TAIKAI_LABELS.kojinScoreFocus),
      mainIssue: pick(r, TAIKAI_LABELS.kojinMainIssue)
    } : null;

    var sync = hasSync ? {
      rank: pick(r, TAIKAI_LABELS.syncRank),
      score: pickNum(r, TAIKAI_LABELS.syncScore),
      timing: pick(r, TAIKAI_LABELS.syncTiming),
      timingCause: pick(r, TAIKAI_LABELS.syncTimingCause),
      goodThing: pick(r, TAIKAI_LABELS.syncGoodThing)
    } : null;

    var meetDate = pick(r, TAIKAI_LABELS.meetDate);
    var meetName = pick(r, TAIKAI_LABELS.meetName);
    // 突き合わせは名前＋大会名で行う（名前は readTaikaiResults_ で絞り込み済み）。
    // 日付は使わない：予選と決勝が別日開催になる大会があり、日付で絞ると片方が落ちるため。
    // 該当する行は全行をそのまま渡し、「個人は決勝を拾う」のような決め打ちは画面側でもしない。
    var mk = meetKey_(meetName);
    var official = mk ? allResults.filter(function (x) { return x.meetKey === mk; }) : [];

    return {
      timestamp: r['タイムスタンプ'] || null,
      meetName: meetName,
      meetDate: meetDate,
      events: events,
      kojin: kojin,
      sync: sync,
      official: official,
      common: {
        nextFunScope: pick(r, TAIKAI_LABELS.nextFunScope),
        nextFunText: pick(r, TAIKAI_LABELS.nextFunText),
        selfWord: pick(r, TAIKAI_LABELS.selfWord)
      }
    };
  });

  records.sort(function (a, b) {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return { name: name, records: records };
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
