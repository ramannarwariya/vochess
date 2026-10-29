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
  var TAIL_MS = 800;        // keep the mic closed this long after speech ends
  var quietUntil = 0;       // timestamp until which we treat the room as "noisy"
  var wantMic = false;      // does the app/user want the mic on?
  var micRunning = false;   // is the recognizer actually running right now?
  var internalStop = false; // true while WE (not the app) stop the mic
  var origRecStart = null, origRecStop = null, origRecAbort = null;
 
  function isBusy() {
    try { if (synth && (synth.speaking || synth.pending)) return true; } catch (e) {}
    return Date.now() < quietUntil;
  }
 
  // Drops any "result" event that arrives while the app is speaking.
  function guardResults(rec) {
    if (rec.__vcGuard) return;
    rec.__vcGuard = true;
 
    var handler = rec.onresult || null;
    try { rec.onresult = null; } catch (e) {}
 
    var nativeAdd = rec.addEventListener.bind(rec);
 
    // Catch listeners added with addEventListener("result", ...)
    rec.addEventListener = function (type, fn, opts) {
      if (type === "result" && typeof fn === "function") {
        return nativeAdd(type, function (e) {
          if (isBusy()) return;
          return fn.call(this, e);
        }, opts);
      }
      return nativeAdd(type, fn, opts);
    };
 
    // Catch the "onresult = function" style
    Object.defineProperty(rec, "onresult", {
      configurable: true,
      get: function () { return handler; },
      set: function (fn) { handler = fn; }
    });
    nativeAdd("result", function (e) {
      if (isBusy()) return;
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
        // If the app is talking, don't start now; the watcher below
        // will start the mic as soon as it is quiet.
        if (isBusy() || micRunning) return;
        micRunning = true;
        return origRecStart.apply(this, arguments);
      };
 
      Ctor.prototype.stop = function () {
        if (!internalStop) wantMic = false;   // user/app really turned it off
        return origRecStop.apply(this, arguments);
      };
 
      Ctor.prototype.abort = function () {
        if (!internalStop) wantMic = false;
        return origRecAbort.apply(this, arguments);
      };
    });
 
    // Watcher: reopen the mic once the app has finished speaking.
    setInterval(function () {
      if (wantMic && lastRecognition && !micRunning && !isBusy()) {
        realStart(lastRecognition);
      }
    }, 250);
  }
 
  function patchSpeech() {
    if (!window.SpeechSynthesis || !window.SpeechSynthesis.prototype) return;
    var origSpeak = window.SpeechSynthesis.prototype.speak;
    window.SpeechSynthesis.prototype.speak = function (utterance) {
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
 
      // Close the mic BEFORE any sound comes out, and keep it closed
      // for a short tail after the speech ends.
      try {
        if (utterance) {
          var markDone = function () { quietUntil = Date.now() + TAIL_MS; };
          utterance.addEventListener("end", markDone);
          utterance.addEventListener("error", markDone);
        }
        quietUntil = Date.now() + TAIL_MS;
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
      // Restart the mic so it picks up the new language. This is an
      // internal stop, so wantMic stays true and the watcher reopens it.
      if (lastRecognition) {
        internalStop = true;
        try { lastRecognition.stop(); } catch (e) {}
        internalStop = false;
      }
      try { window.speechSynthesis.getVoices(); } catch (e) {}
    });
  }
 
  // Debug helper: type vcListVoices() in the browser console.
  window.vcListVoices = function () {
    var list = (window.speechSynthesis.getVoices() || []).map(function (v) {
      return v.lang + "  -  " + v.name;
    });
    console.log(list.join("\n"));
    return list;
  };
 
  // Patch right away, before the main app creates its recognition/speech.
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
    setTime(clockEls.wTime, formatClock(used.w));
    setTime(clockEls.bTime, formatClock(used.b));
    setTime(clockEls.moves, pad(count));
 
    var active = gameScreenVisible() ? side : null;
    clockEls.w.classList.toggle("is-active", active === "w");
    clockEls.b.classList.toggle("is-active", active === "b");
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
      '<span class="dg-item dg-spacer"><span class="dg-realclock" id="dgRealClock">--:--:--</span></span>';
    document.body.appendChild(el);
 
    ["MicVal", "MicLed", "TtsVal", "TtsLed", "SfxVal", "SfxLed", "LangVal", "ModeVal", "LanVal", "LanLed", "RealClock"]
      .forEach(function (k) { bar[k] = $("dg" + k); });
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
 
