(function () {
  "use strict";
 
  var $ = function (id) { return document.getElementById(id); };
  var THEME_KEY = "voiceChessDigitalTheme";
 
  /* ================================================================
     LANGUAGE FOLLOW-THROUGH
     Makes speech recognition (mic) and speech output (voice) use the
     language chosen in the page's #selectVoiceLang dropdown.
     ================================================================ */
 
  var EXTRA_LANGS = [
    ["en-US", "English (US)"],
    ["en-IN", "English (India)"],
    ["hi-IN", "हिन्दी"],
    ["ta-IN", "தமிழ்"],
    ["te-IN", "తెలుగు"],
    ["bn-IN", "বাংলা"],
    ["mr-IN", "मराठी"],
    ["gu-IN", "ગુજરાતી"],
    ["kn-IN", "ಕನ್ನಡ"],
    ["ml-IN", "മലയാളം"],
    ["pa-IN", "ਪੰਜਾਬੀ"],
    ["es-ES", "Español"],
    ["de-DE", "Deutsch"],
    ["fr-FR", "Français"],
    ["ja-JP", "日本語"]
  ];
 
  var BARE = {
    en: "en-US", hi: "hi-IN", ta: "ta-IN", te: "te-IN", bn: "bn-IN",
    mr: "mr-IN", gu: "gu-IN", kn: "kn-IN", ml: "ml-IN", pa: "pa-IN",
    es: "es-ES", de: "de-DE", fr: "fr-FR", ja: "ja-JP"
  };
 
  var VOICE_FALLBACK = {
    "mr-IN": ["hi-IN"]
  };
 
  var lastRecognition = null;
 
  function selectedLang() {
    var sel = $("selectVoiceLang");
    if (!sel) return null;
    var v = String(sel.value || "").trim();
    if (/^hinglish$/i.test(v)) return "hi-IN";
    if (BARE[v.toLowerCase()]) return BARE[v.toLowerCase()];
    if (/^[a-z]{2,3}-[A-Za-z0-9]{2,4}$/.test(v)) return v;
    return null;
  }
 
  function pickVoiceFor(lang) {
    var voices = [];
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) {}
    var want = lang.toLowerCase();
    var base = want.split("-")[0];
    var exact = null, partial = null;
    for (var i = 0; i < voices.length; i++) {
      var vl = String(voices[i].lang || "").replace("_", "-").toLowerCase();
      if (vl === want) { exact = voices[i]; break; }
      if (!partial && vl.indexOf(base) === 0) partial = voices[i];
    }
    return exact || partial || null;
  }
 
  /* ================================================================
     ECHO GUARD: the mic must never listen while the app is speaking
     ================================================================ */
 
  var synth = window.speechSynthesis;
  var TAIL_MS = 1500;
  var quietUntil = 0;
  var wantMic = false;
  var micRunning = false;
  var internalStop = false;
  var origRecStart = null, origRecStop = null, origRecAbort = null;
  var latestUtterance = null;
  var recentSpoken = [];

  function tokens(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097f\s]/g, " ")
      .split(/\s+/).filter(Boolean);
  }

  function rememberSpoken(text) {
    var now = Date.now();
    recentSpoken.push({ t: now, words: tokens(text) });
    recentSpoken = recentSpoken.filter(function (x) { return now - x.t < 20000; });
  }

  function isEchoOfRecentSpeech(text) {
    var w = tokens(text);
    if (w.length < 5) return false;
    var now = Date.now(), pool = {}, hit = 0;
    recentSpoken.forEach(function (x) {
      if (now - x.t < 20000) x.words.forEach(function (k) { pool[k] = true; });
    });
    w.forEach(function (k) { if (pool[k]) hit++; });
    return hit / w.length >= 0.8;
  }

  function eventIsEcho(e) {
    try {
      for (var i = e.resultIndex || 0; i < e.results.length; i++) {
        var r = e.results[i];
        if (r && r[0] && isEchoOfRecentSpeech(r[0].transcript)) return true;
      }
    } catch (err) {}
    return false;
  }
 
  function isBusy() {
    try { if (synth && (synth.speaking || synth.pending)) return true; } catch (e) {}
    return Date.now() < quietUntil;
  }
 
  function guardResults(rec) {
    if (rec.__vcGuard) return;
    rec.__vcGuard = true;
 
    var handler = rec.onresult || null;
    try { rec.onresult = null; } catch (e) {}
 
    var nativeAdd = rec.addEventListener.bind(rec);
 
    rec.addEventListener = function (type, fn, opts) {
      if (type === "result" && typeof fn === "function") {
        return nativeAdd(type, function (e) {
          if (isBusy() || eventIsEcho(e)) return;
          return fn.call(this, e);
        }, opts);
      }
      return nativeAdd(type, fn, opts);
    };
 
    Object.defineProperty(rec, "onresult", {
      configurable: true,
      get: function () { return handler; },
      set: function (fn) { handler = fn; }
    });
    nativeAdd("result", function (e) {
      if (isBusy() || eventIsEcho(e)) return;
      if (typeof handler === "function") handler.call(rec, e);
    });
 
    nativeAdd("start", function () { micRunning = true; });
    nativeAdd("end", function () { micRunning = false; });
  }
 
  function realStart(rec) {
    if (micRunning) return;
    try { origRecStart.call(rec); micRunning = true; } catch (e) {}
  }
 
  function pauseMic() {
    if (!lastRecognition || !micRunning) return;
    internalStop = true;
    try { origRecAbort.call(lastRecognition); } catch (e) {}
    internalStop = false;
    micRunning = false;
  }
 
  function patchRecognition() {
    var seen = [];
    ["SpeechRecognition", "webkitSpeechRecognition"].forEach(function (name) {
      var Ctor = window[name];
      if (!Ctor || !Ctor.prototype || seen.indexOf(Ctor.prototype) !== -1) return;
      seen.push(Ctor.prototype);
 
      origRecStart = Ctor.prototype.start;
      origRecStop  = Ctor.prototype.stop;
      origRecAbort = Ctor.prototype.abort;
 
      Ctor.prototype.start = function () {
        lastRecognition = this;
        guardResults(this);
        wantMic = true;
        var lang = selectedLang();
        if (lang) { try { this.lang = lang; } catch (e) {} }
        if (isBusy() || micRunning) return;
        micRunning = true;
        return origRecStart.apply(this, arguments);
      };
 
      Ctor.prototype.stop = function () {
        if (!internalStop) wantMic = false;
        return origRecStop.apply(this, arguments);
      };
 
      Ctor.prototype.abort = function () {
        if (!internalStop) wantMic = false;
        return origRecAbort.apply(this, arguments);
      };
    });
 
    setInterval(function () {
      if (wantMic && lastRecognition && !micRunning && !isBusy()) {
        realStart(lastRecognition);
      }
    }, 250);

    setInterval(function () {
      if (lastRecognition && micRunning && isBusy()) pauseMic();
    }, 100);
  }
 
  function patchSpeech() {
    var target = (window.SpeechSynthesis && window.SpeechSynthesis.prototype) ||
                 (window.speechSynthesis && Object.getPrototypeOf(window.speechSynthesis));
    if (!target || typeof target.speak !== "function") return;
    var origSpeak = target.speak;
    target.speak = function (utterance) {
      try {
        var lang = selectedLang();
        if (lang && utterance) {
          utterance.lang = lang;
          var voice = pickVoiceFor(lang);
          if (!voice && VOICE_FALLBACK[lang]) {
            for (var f = 0; f < VOICE_FALLBACK[lang].length && !voice; f++) {
              voice = pickVoiceFor(VOICE_FALLBACK[lang][f]);
            }
            if (voice) utterance.lang = voice.lang;
          }
          if (voice) utterance.voice = voice;
        }
      } catch (e) {}

      try {
        if (utterance) {
          latestUtterance = utterance;
          rememberSpoken(utterance.text);
          var markDone = function () {
            if (utterance === latestUtterance) quietUntil = Date.now() + TAIL_MS;
          };
          utterance.addEventListener("end", markDone);
          utterance.addEventListener("error", markDone);
        }
        quietUntil = Math.max(quietUntil, Date.now() + TAIL_MS);
        pauseMic();
      } catch (e) {}

      return origSpeak.call(this, utterance);
    };
  }

  function addLanguageOptions() {
    var sel = $("selectVoiceLang");
    if (!sel) return;
    var have = {};
    for (var i = 0; i < sel.options.length; i++) have[sel.options[i].value] = true;
    EXTRA_LANGS.forEach(function (pair) {
      if (have[pair[0]]) return;
      var opt = document.createElement("option");
      opt.value = pair[0];
      opt.textContent = pair[1];
      sel.appendChild(opt);
    });
  }
 
  function hookLanguageSelect() {
    var sel = $("selectVoiceLang");
    if (!sel) return;
    sel.addEventListener("change", function () {
      if (lastRecognition) {
        internalStop = true;
        try { lastRecognition.stop(); } catch (e) {}
        internalStop = false;
      }
      try { window.speechSynthesis.getVoices(); } catch (e) {}
    });
  }
 
  window.vcListVoices = function () {
    var list = (window.speechSynthesis.getVoices() || []).map(function (v) {
      return v.lang + "  -  " + v.name;
    });
    console.log(list.join("\n"));
    return list;
  };
 
  patchRecognition();
  patchSpeech();
 
  /* ---------------------------------------------------------------- Theme */
 
  function loadThemePref() {
    try {
      var saved = localStorage.getItem(THEME_KEY);
      return saved === null ? true : saved === "on";
    } catch (e) {
      return true;
    }
  }
 
  function saveThemePref(on) {
    try { localStorage.setItem(THEME_KEY, on ? "on" : "off"); } catch (e) {}
  }
 
  var themeBtn = null;
 
  function applyTheme(on) {
    document.documentElement.classList.toggle("theme-digital", on);
    if (themeBtn) {
      themeBtn.textContent = on ? "🖥️ Theme: Digital" : "☀️ Theme: Classic";
      themeBtn.setAttribute("aria-pressed", String(on));
    }
    saveThemePref(on);
  }
 
  function addThemeButton() {
    var anchor = $("btnOpenStepModal") || $("btnToggleSound");
    if (!anchor || !anchor.parentNode) return;
 
    themeBtn = document.createElement("button");
    themeBtn.type = "button";
    themeBtn.id = "btnToggleDigitalTheme";
    themeBtn.className =
      "inline-flex items-center gap-1 px-2.5 py-2 rounded-xl font-medium text-xs " +
      "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition";
    themeBtn.title = "Switch between the digital and classic look";
    themeBtn.addEventListener("click", function () {
      applyTheme(!document.documentElement.classList.contains("theme-digital"));
    });
    anchor.parentNode.appendChild(themeBtn);
  }
 
  /* --------------------------------------------------------- Digital clocks */
 
  var clockEls = {};
  var used = { w: 0, b: 0 };
  var lastTick = Date.now();
  var lastMoveCount = 0;
  var currentSessionMoves = [];
  var currentSessionRecorded = false;
  var sessionStartTime = Date.now();
 
  function pad(n) { return n < 10 ? "0" + n : String(n); }
 
  function formatClock(ms) {
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
  }
 
  function setTime(el, text) {
    if (!el) return;
    el.textContent = text;
    el.setAttribute("data-ghost", text.replace(/\d/g, "8"));
  }
 
  function buildClocks() {
    var board = $("boardWrapper");
    if (!board || !board.parentNode) return;
 
    var wrap = document.createElement("div");
    wrap.className = "dg-clocks";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML =
      '<div class="dg-clock" id="dgClockW">' +
        '<div class="dg-clock-label"><span class="dg-pip"></span>White</div>' +
        '<div class="dg-time" data-ghost="88:88">00:00</div>' +
      "</div>" +
      '<div class="dg-moves">' +
        '<div class="dg-clock-label">Moves</div>' +
        '<div class="dg-time" id="dgMoves" data-ghost="88">00</div>' +
      "</div>" +
      '<div class="dg-clock" id="dgClockB">' +
        '<div class="dg-clock-label"><span class="dg-pip"></span>Black</div>' +
        '<div class="dg-time" data-ghost="88:88">00:00</div>' +
      "</div>";
 
    board.parentNode.insertBefore(wrap, board);
 
    clockEls.w = $("dgClockW");
    clockEls.b = $("dgClockB");
    clockEls.wTime = clockEls.w.querySelector(".dg-time");
    clockEls.bTime = clockEls.b.querySelector(".dg-time");
    clockEls.moves = $("dgMoves");
  }
 
  function gameScreenVisible() {
    var g = $("screenGame");
    return !!g && !g.classList.contains("hidden");
  }
 
  function currentSide() {
    var badge = $("turnIndicatorBadge");
    var text = badge ? badge.textContent : "";
    if (/game over/i.test(text)) return null;
    if (/^\s*black/i.test(text)) return "b";
    if (/^\s*white/i.test(text)) return "w";
    return null;
  }
 
  function readMoveCount() {
    var label = $("moveCountLabel");
    var match = label ? /(\d+)/.exec(label.textContent) : null;
    return match ? parseInt(match[1], 10) : 0;
  }

  /* ================================================================
     INDEXEDDB GAME HISTORY DATABASE
     Automatically stores every finished or reset game record
     ================================================================ */

  var DB_NAME = "VoiceChessHistoryDB";
  var DB_VERSION = 1;
  var STORE_NAME = "games";
  var FALLBACK_KEY = "voiceChessGamesBackup";
  var dbInstance = null;

  function openGameDatabase() {
    return new Promise(function (resolve) {
      if (dbInstance) {
        resolve(dbInstance);
        return;
      }
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      try {
        var req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            var store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
            store.createIndex("timestamp", "timestamp", { unique: false });
          }
        };
        req.onsuccess = function (e) {
          dbInstance = e.target.result;
          resolve(dbInstance);
        };
        req.onerror = function () {
          resolve(null);
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function saveGameToDB(record) {
    return openGameDatabase().then(function (db) {
      if (!db) {
        try {
          var list = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]");
          record.id = Date.now();
          list.unshift(record);
          localStorage.setItem(FALLBACK_KEY, JSON.stringify(list.slice(0, 200)));
        } catch (e) {}
        updateHistoryCountBadge();
        return;
      }
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction([STORE_NAME], "readwrite");
          var store = tx.objectStore(STORE_NAME);
          store.add(record);
          tx.oncomplete = function () {
            updateHistoryCountBadge();
            resolve();
          };
          tx.onerror = function () { resolve(); };
        } catch (e) {
          resolve();
        }
      });
    });
  }

  function getAllGamesFromDB() {
    return openGameDatabase().then(function (db) {
      if (!db) {
        try {
          return JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]");
        } catch (e) {
          return [];
        }
      }
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction([STORE_NAME], "readonly");
          var store = tx.objectStore(STORE_NAME);
          var req = store.getAll();
          req.onsuccess = function () {
            var res = req.result || [];
            res.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
            resolve(res);
          };
          req.onerror = function () { resolve([]); };
        } catch (e) {
          resolve([]);
        }
      });
    });
  }

  function deleteGameFromDB(id) {
    return openGameDatabase().then(function (db) {
      if (!db) {
        try {
          var list = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]");
          list = list.filter(function (g) { return g.id !== id; });
          localStorage.setItem(FALLBACK_KEY, JSON.stringify(list));
        } catch (e) {}
        return;
      }
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction([STORE_NAME], "readwrite");
          tx.objectStore(STORE_NAME).delete(id);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) {
          resolve();
        }
      });
    });
  }

  function clearAllGamesFromDB() {
    return openGameDatabase().then(function (db) {
      try { localStorage.removeItem(FALLBACK_KEY); } catch (e) {}
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction([STORE_NAME], "readwrite");
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) {
          resolve();
        }
      });
    });
  }

  // Scrapes the current move list from #moveHistoryContainer
  function scrapeMovesFromDOM() {
    var box = $("moveHistoryContainer");
    if (!box) return [];
    var rows = box.querySelectorAll("div.flex");
    var pairs = [];
    for (var i = 0; i < rows.length; i++) {
      var spans = rows[i].querySelectorAll("span.flex-1");
      if (spans.length >= 1) {
        var wText = spans[0].textContent.trim();
        var bText = spans[1] ? spans[1].textContent.trim() : "";
        if (wText) pairs.push({ moveNumber: i + 1, white: wText, black: bText });
      }
    }
    return pairs;
  }

  function buildPgnFromPairs(pairs, resultToken) {
    if (!pairs || !pairs.length) return "";
    var parts = pairs.map(function (p) {
      var wAlg = p.white.split(" ")[0];
      var bAlg = p.black ? p.black.split(" ")[0] : "";
      return p.moveNumber + ". " + wAlg + (bAlg ? " " + bAlg : "");
    });
    return parts.join(" ") + (resultToken ? " " + resultToken : "");
  }

  function detectOutcomeDetails(announcementText, isAbandoned) {
    var msg = String(announcementText || "");
    if (isAbandoned) {
      return {
        winner: "Incomplete",
        reason: "Reset / Abandoned",
        resultCode: "*",
        summary: "Game reset after " + lastMoveCount + " moves"
      };
    }
    if (/checkmate/i.test(msg)) {
      var wWins = /white wins/i.test(msg);
      return {
        winner: wWins ? "White" : "Black",
        reason: "Checkmate",
        resultCode: wWins ? "1-0" : "0-1",
        summary: msg
      };
    }
    if (/resigned/i.test(msg)) {
      var wWinsRes = /white wins/i.test(msg);
      return {
        winner: wWinsRes ? "White" : "Black",
        reason: "Resignation",
        resultCode: wWinsRes ? "1-0" : "0-1",
        summary: msg
      };
    }
    if (/stalemate/i.test(msg)) {
      return {
        winner: "Draw",
        reason: "Stalemate",
        resultCode: "1/2-1/2",
        summary: msg
      };
    }
    if (/draw/i.test(msg)) {
      return {
        winner: "Draw",
        reason: "Agreed Draw",
        resultCode: "1/2-1/2",
        summary: msg
      };
    }
    return {
      winner: "Completed",
      reason: "Game Over",
      resultCode: "*",
      summary: msg || "Game finished"
    };
  }

  function getActiveModeLabel() {
    var modeSel = $("selectGameMode");
    var mode = modeSel ? modeSel.value : "";
    if (mode === "ai") {
      var diffSel = $("selectDifficulty");
      var diffVal = diffSel ? diffSel.value : "2";
      var diffName = diffVal === "1" ? "Easy" : diffVal === "3" ? "Hard" : "Medium";
      return "VS AI (" + diffName + ")";
    }
    if (mode === "lan") return "2P LAN";
    if (mode === "pass") return "2P Same PC";
    return "Standard";
  }

  function recordCurrentGame(isAbandoned) {
    if (currentSessionRecorded || lastMoveCount === 0) return;
    currentSessionRecorded = true;

    var annEl = $("assistantAnnouncement");
    var annText = annEl ? annEl.textContent.trim() : "";
    var outcome = detectOutcomeDetails(annText, isAbandoned);

    var topNameEl = $("topPlayerName");
    var botNameEl = $("bottomPlayerName");

    var pairs = currentSessionMoves.length ? currentSessionMoves : scrapeMovesFromDOM();
    var pgn = buildPgnFromPairs(pairs, outcome.resultCode);

    var record = {
      timestamp: Date.now(),
      dateStr: new Date().toLocaleString(),
      mode: getActiveModeLabel(),
      whitePlayer: botNameEl ? botNameEl.textContent.trim() : "White",
      blackPlayer: topNameEl ? topNameEl.textContent.trim() : "Black",
      totalPly: lastMoveCount,
      whiteTimeMs: used.w,
      blackTimeMs: used.b,
      whiteTimeFormatted: formatClock(used.w),
      blackTimeFormatted: formatClock(used.b),
      durationFormatted: formatClock(used.w + used.b),
      winner: outcome.winner,
      reason: outcome.reason,
      resultCode: outcome.resultCode,
      summary: outcome.summary,
      moves: pairs,
      pgn: pgn
    };

    saveGameToDB(record);
  }

  function checkAndRecordGameEnd() {
    var count = readMoveCount();

    // Keep live snapshot of moves while a game is in progress
    if (count > 0) {
      var latestMoves = scrapeMovesFromDOM();
      if (latestMoves.length > 0) currentSessionMoves = latestMoves;
    }

    // If a game had moves and the board was just reset before "Game Over", save as Incomplete/Reset
    if (lastMoveCount > 0 && count === 0) {
      if (!currentSessionRecorded) {
        recordCurrentGame(true);
      }
      used.w = 0;
      used.b = 0;
      currentSessionMoves = [];
      currentSessionRecorded = false;
      sessionStartTime = Date.now();
    }

    lastMoveCount = count;

    // Detect natural Game Over (Checkmate, Stalemate, Resignation, Draw)
    var badge = $("turnIndicatorBadge");
    var isGameOver = badge && /game over/i.test(badge.textContent);
    if (isGameOver && count > 0 && !currentSessionRecorded) {
      recordCurrentGame(false);
    }
  }
 
  function tickClocks() {
    var now = Date.now();
    var dt = Math.min(now - lastTick, 60000);
    lastTick = now;
 
    var count = readMoveCount();
    if (lastMoveCount > 0 && count === 0) {
      used.w = 0;
      used.b = 0;
    }
    lastMoveCount = count;
 
    var side = currentSide();
    if (side && gameScreenVisible()) used[side] += dt;
 
    if (!clockEls.wTime) return;
    var wFormatted = formatClock(used.w);
    var bFormatted = formatClock(used.b);
    setTime(clockEls.wTime, wFormatted);
    setTime(clockEls.bTime, bFormatted);
    setTime(clockEls.moves, pad(count));

    // Sync elapsed times into the Game Ending Modal
    var goWhite = $("gameOverWhiteTime");
    var goBlack = $("gameOverBlackTime");
    if (goWhite) goWhite.textContent = wFormatted;
    if (goBlack) goBlack.textContent = bFormatted;
 
    var active = gameScreenVisible() ? side : null;
    clockEls.w.classList.toggle("is-active", active === "w");
    clockEls.b.classList.toggle("is-active", active === "b");
  }

  /* ------------------------------------- Game Over Confetti Celebration */
  var confettiFrame = null;

  window.vcTriggerGameOverEffects = function (outcomeType) {
    var canvas = $("gameOverConfetti");
    if (!canvas) return;
    if (confettiFrame) {
      cancelAnimationFrame(confettiFrame);
      confettiFrame = null;
    }
    var ctx = canvas.getContext("2d");
    var rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 420, height: 360 };
    canvas.width = rect.width || 420;
    canvas.height = rect.height || 360;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (outcomeType !== "win") return;

    var colors = ["#34d399", "#22d3ee", "#fbbf24", "#a855f7", "#60a5fa", "#f43f5e"];
    var particles = [];
    for (var i = 0; i < 65; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() - 0.5) * 80,
        y: canvas.height * 0.35,
        vx: (Math.random() - 0.5) * 9,
        vy: -Math.random() * 8 - 3,
        size: Math.random() * 6 + 4,
        color: colors[i % colors.length],
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2,
        alpha: 1
      });
    }

    function step() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var alive = false;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.22;
        p.rot += p.vRot;
        p.alpha -= 0.008;
        if (p.alpha > 0 && p.y < canvas.height + 20) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
          ctx.restore();
        }
      }
      if (alive) {
        confettiFrame = requestAnimationFrame(step);
      }
    }
    confettiFrame = requestAnimationFrame(step);
  };

  /* ================================================================
     GAME HISTORY MODAL UI CONTROLLER
     ================================================================ */

  function updateHistoryCountBadge() {
    getAllGamesFromDB().then(function (games) {
      var badge = $("historyCountBadge");
      if (badge) badge.textContent = String(games.length);
      if (bar.DbVal) bar.DbVal.textContent = String(games.length);
    });
  }

  function winnerBadgeHtml(winner, resultCode) {
    if (winner === "White") {
      return '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">🏆 White Won (' + resultCode + ')</span>';
    }
    if (winner === "Black") {
      return '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">🏆 Black Won (' + resultCode + ')</span>';
    }
    if (winner === "Draw") {
      return '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">🤝 Draw (' + resultCode + ')</span>';
    }
    return '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">⏹️ ' + winner + '</span>';
  }

  function renderHistoryModalList() {
    var listEl = $("historyRecordsList");
    var statsEl = $("historyStatsSummary");
    if (!listEl) return;

    getAllGamesFromDB().then(function (games) {
      if (statsEl) {
        var wWins = games.filter(function (g) { return g.winner === "White"; }).length;
        var bWins = games.filter(function (g) { return g.winner === "Black"; }).length;
        var draws = games.filter(function (g) { return g.winner === "Draw"; }).length;
        statsEl.innerHTML =
          '<span>Total Saved: <strong class="text-slate-900">' + games.length + '</strong></span>' +
          '<span>White Wins: <strong class="text-emerald-700">' + wWins + '</strong></span>' +
          '<span>Black Wins: <strong class="text-blue-700">' + bWins + '</strong></span>' +
          '<span>Draws: <strong class="text-amber-800">' + draws + '</strong></span>';
      }

      if (games.length === 0) {
        listEl.innerHTML =
          '<div class="text-center py-10 text-slate-400 text-sm">' +
            'No games recorded yet. Play a game (Checkmate, Resign, Draw, or New Game) and it will automatically be saved here!' +
          '</div>';
        return;
      }

      var html = "";
      games.forEach(function (g) {
        html +=
          '<div class="vc-db-card bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">' +
            '<div class="flex flex-wrap items-center justify-between gap-2">' +
              '<div class="flex flex-wrap items-center gap-2">' +
                winnerBadgeHtml(g.winner, g.resultCode || "*") +
                '<span class="text-xs font-bold text-slate-700">' + (g.reason || "Match") + '</span>' +
                '<span class="text-[11px] px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 font-semibold">' + (g.mode || "Chess") + '</span>' +
              '</div>' +
              '<div class="flex items-center gap-2 text-[11px] text-slate-500">' +
                '<span class="dg-mono-font">' + (g.dateStr || "") + '</span>' +
                '<button type="button" data-copy-pgn="' + encodeURIComponent(g.pgn || "") + '" class="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-semibold transition">Copy PGN</button>' +
                '<button type="button" data-del-id="' + g.id + '" class="px-2 py-0.5 rounded bg-red-100 hover:bg-red-600 hover:text-white text-red-700 font-semibold transition" title="Delete record">✕</button>' +
              '</div>' +
            '</div>' +
            '<div class="flex flex-wrap items-center gap-4 text-xs text-slate-600">' +
              '<span>⚪ <strong>White:</strong> ' + (g.whiteTimeFormatted || "00:00") + '</span>' +
              '<span>⚫ <strong>Black:</strong> ' + (g.blackTimeFormatted || "00:00") + '</span>' +
              '<span>♟️ <strong>Moves:</strong> ' + (g.totalPly || 0) + ' half-moves</span>' +
            '</div>' +
            '<div class="vc-db-pgn bg-white border border-slate-200 rounded-lg p-2 text-slate-700">' +
              (g.pgn ? g.pgn : '<span class="italic text-slate-400">No moves notation</span>') +
            '</div>' +
          '</div>';
      });

      listEl.innerHTML = html;

      // Wire Copy PGN buttons
      listEl.querySelectorAll("[data-copy-pgn]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var pgnText = decodeURIComponent(btn.getAttribute("data-copy-pgn") || "");
          if (navigator.clipboard && pgnText) {
            navigator.clipboard.writeText(pgnText).then(function () {
              var orig = btn.textContent;
              btn.textContent = "Copied!";
              setTimeout(function () { btn.textContent = orig; }, 1200);
            });
          }
        });
      });

      // Wire Delete record buttons
      listEl.querySelectorAll("[data-del-id]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = Number(btn.getAttribute("data-del-id"));
          deleteGameFromDB(id).then(function () {
            updateHistoryCountBadge();
            renderHistoryModalList();
          });
        });
      });
    });
  }

  function setupHistoryModalEvents() {
    var modal = $("gameHistoryModal");
    var openBtn = $("btnOpenHistoryModal");
    var closeBtn = $("btnCloseHistoryModal");
    var doneBtn = $("btnDoneHistoryModal");
    var clearBtn = $("btnClearHistoryDB");
    var exportBtn = $("btnExportHistoryJSON");

    if (!modal) return;

    function openHistory() {
      renderHistoryModalList();
      modal.classList.remove("hidden");
      modal.classList.add("flex");
    }

    function closeHistory() {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }

    if (openBtn) openBtn.addEventListener("click", openHistory);
    if (closeBtn) closeBtn.addEventListener("click", closeHistory);
    if (doneBtn) doneBtn.addEventListener("click", closeHistory);

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        clearAllGamesFromDB().then(function () {
          updateHistoryCountBadge();
          renderHistoryModalList();
        });
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        getAllGamesFromDB().then(function (games) {
          var blob = new Blob([JSON.stringify(games, null, 2)], { type: "application/json" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = "voicechess_history_" + new Date().toISOString().slice(0, 10) + ".json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });
      });
    }
  }
 
  /* ------------------------------------------------------------ Status bar */
 
  var bar = {};
 
  function item(label, valueId, ledId) {
    return (
      '<span class="dg-item">' +
        (ledId ? '<span class="dg-led" id="' + ledId + '"></span>' : "") +
        label +
        (valueId ? ' <span class="dg-val" id="' + valueId + '">--</span>' : "") +
      "</span>"
    );
  }
 
  function buildStatusBar() {
    var el = document.createElement("div");
    el.className = "dg-statusbar";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "off");
    el.innerHTML =
      item("Mic", "dgMicVal", "dgMicLed") +
      item("Voice", "dgTtsVal", "dgTtsLed") +
      item("FX", "dgSfxVal", "dgSfxLed") +
      item("Lang", "dgLangVal", null) +
      item("Mode", "dgModeVal", null) +
      item("Link", "dgLanVal", "dgLanLed") +
      item("DB", "dgDbVal", "dgDbLed") +
      '<span class="dg-item dg-spacer"><span class="dg-realclock" id="dgRealClock">--:--:--</span></span>';
    document.body.appendChild(el);
 
    ["MicVal", "MicLed", "TtsVal", "TtsLed", "SfxVal", "SfxLed", "LangVal", "ModeVal", "LanVal", "LanLed", "DbVal", "DbLed", "RealClock"]
      .forEach(function (k) { bar[k] = $("dg" + k); });
    setLed(bar.DbLed, "on");
  }
 
  function setLed(led, state) {
    if (!led) return;
    led.className = "dg-led" + (state ? " " + state : "");
  }
 
  function textOf(id) {
    var el = $(id);
    return el ? el.textContent : "";
  }
 
  function refreshStatusBar() {
    var micBtn = $("btnToggleMic");
    var listening = !!micBtn && micBtn.classList.contains("mic-pulse");
    setLed(bar.MicLed, listening ? "rec" : "");
    if (bar.MicVal) bar.MicVal.textContent = listening ? "REC" : "OFF";
 
    var ttsOn = /ON/.test(textOf("ttsStatusText"));
    setLed(bar.TtsLed, ttsOn ? "on" : "");
    if (bar.TtsVal) bar.TtsVal.textContent = ttsOn ? "ON" : "OFF";
 
    var sfxOn = /ON/.test(textOf("sfxStatusText"));
    setLed(bar.SfxLed, sfxOn ? "on" : "");
    if (bar.SfxVal) bar.SfxVal.textContent = sfxOn ? "ON" : "OFF";
 
    var langSel = $("selectVoiceLang");
    if (bar.LangVal && langSel) bar.LangVal.textContent = langSel.value;
 
    var modeSel = $("selectGameMode");
    var mode = modeSel ? modeSel.value : "";
    if (bar.ModeVal) {
      bar.ModeVal.textContent = mode === "lan" ? "LAN" : mode === "ai" ? "VS AI" : mode === "pass" ? "2P LOCAL" : "--";
    }
 
    var lanText = textOf("lanStatusPill").trim();
    if (mode !== "lan") {
      setLed(bar.LanLed, "");
      if (bar.LanVal) bar.LanVal.textContent = "N/A";
    } else if (/connected/i.test(lanText)) {
      setLed(bar.LanLed, "on");
      if (bar.LanVal) bar.LanVal.textContent = "UP";
    } else if (/waiting|connecting/i.test(lanText)) {
      setLed(bar.LanLed, "warn");
      if (bar.LanVal) bar.LanVal.textContent = "WAIT";
    } else {
      setLed(bar.LanLed, "");
      if (bar.LanVal) bar.LanVal.textContent = "IDLE";
    }
 
    if (bar.RealClock) {
      var d = new Date();
      bar.RealClock.textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    }
  }
 
  /* ----------------------------------------------- Announcement glow effect */
 
  function watchAnnouncements() {
    var el = $("assistantAnnouncement");
    if (!el || !window.MutationObserver) return;
 
    new MutationObserver(function () {
      el.classList.remove("dg-flash");
      void el.offsetWidth;
      el.classList.add("dg-flash");
      checkAndRecordGameEnd();
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }
 
  /* ------------------------------------------------------------------ Start */
 
  function start() {
    addThemeButton();
    applyTheme(loadThemePref());
    buildClocks();
    buildStatusBar();
    watchAnnouncements();
 
    addLanguageOptions();
    hookLanguageSelect();

    openGameDatabase().then(function () {
      updateHistoryCountBadge();
      setupHistoryModalEvents();
    });
 
    lastTick = Date.now();
    tickClocks();
    refreshStatusBar();
 
    setInterval(tickClocks, 250);
    setInterval(refreshStatusBar, 400);
  }
 
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
