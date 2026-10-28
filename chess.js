(() => {
  const $ = id => document.getElementById(id);

  const SYMBOLS = {
    w: { p: "♙", r: "♖", n: "♘", b: "♗", q: "♕", k: "♔" },
    b: { p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚" }
  };

  const NAMES = {
    p: "pawn", r: "rook", n: "knight",
    b: "bishop", q: "queen", k: "king"
  };

  let game, selected = null, flipped = false;
  let recognition = null, listening = false;
  let foundSquare = null, lastMove = null;

  const boardEl = $("board");

  function initGame() {
    if (typeof Chess !== "function") {
      $("status").textContent =
        "Chess rules library could not load. Check your internet connection and reload.";
      $("engineBadge").textContent = "Library unavailable";
      return;
    }

    game = new Chess();
    selected = null;
    foundSquare = null;
    lastMove = null;

    render();
    updateUI();
    say("New game. White to move.");
  }

  function squareOrder() {
    const files = flipped
      ? ["h", "g", "f", "e", "d", "c", "b", "a"]
      : ["a", "b", "c", "d", "e", "f", "g", "h"];

    const ranks = flipped
      ? [1, 2, 3, 4, 5, 6, 7, 8]
      : [8, 7, 6, 5, 4, 3, 2, 1];

    return ranks.flatMap(r => files.map(f => f + r));
  }

  function render() {
    if (!game) return;

    boardEl.innerHTML = "";

    const legal = selected
      ? game.moves({ square: selected, verbose: true })
      : [];

    for (const sq of squareOrder()) {
      const p = game.get(sq);
      const btn = document.createElement("button");

      btn.type = "button";
      btn.className =
        "sq " +
        (((Number(sq[1]) + sq.charCodeAt(0) - 97) % 2 === 0)
          ? "light"
          : "dark");

      btn.setAttribute(
        "aria-label",
        sq +
        (p
          ? `, ${p.color === "w" ? "white" : "black"} ${NAMES[p.type]}`
          : ", empty") +
        (selected ? `, selected source ${selected}` : "")
      );

      if (selected === sq) btn.classList.add("selected");

      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) {
        btn.classList.add("last");
      }

      if (foundSquare === sq) btn.classList.add("king-found");

      if (legal.some(m => m.to === sq)) {
        btn.classList.add(p ? "capture" : "legal");
      }

      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = sq;
      btn.appendChild(coord);

      if (p) {
        const piece = document.createElement("span");
        piece.className =
          "piece " + (p.color === "w" ? "white-piece" : "black-piece");
        piece.textContent = SYMBOLS[p.color][p.type];
        piece.setAttribute("aria-hidden", "true");
        btn.appendChild(piece);
      }

      btn.addEventListener("click", () => clickSquare(sq));
      boardEl.appendChild(btn);
    }

    $("ranks").innerHTML = (
      flipped
        ? [1, 2, 3, 4, 5, 6, 7, 8]
        : [8, 7, 6, 5, 4, 3, 2, 1]
    ).map(n => `<span>${n}</span>`).join("");

    $("files").innerHTML = (
      flipped
        ? ["h", "g", "f", "e", "d", "c", "b", "a"]
        : ["a", "b", "c", "d", "e", "f", "g", "h"]
    ).map(f => `<span>${f}</span>`).join("");
  }

  function clickSquare(sq) {
    if (!game) return;

    const p = game.get(sq);

    if (!selected) {
      if (!p) {
        setStatus("That square is empty. Choose a piece first.");
        return;
      }

      if (p.color !== game.turn()) {
        setStatus(
          `It is ${game.turn() === "w" ? "White" : "Black"}'s turn. Select that side's piece.`
        );
        return;
      }

      selected = sq;
      foundSquare = null;
      render();

      setStatus(
        `${sq}: ${p.color === "w" ? "White" : "Black"} ${NAMES[p.type]} selected. Choose a destination.`
      );
      return;
    }

    if (selected === sq) {
      selected = null;
      render();
      setStatus("Selection cleared.");
      return;
    }

    const from = selected;
    selected = null;

    const result = makeMove(from, sq);

    if (!result && p && p.color === game.turn()) {
      selected = sq;
      render();
      setStatus(`${sq} selected. Choose a legal destination.`);
    }
  }

  function makeMove(from, to, promotion = "q") {
    const result = game.move({ from, to, promotion });

    if (!result) {
      render();
      setStatus(
        `Illegal move ${from} to ${to}."`
      );
      return false;
    }

    lastMove = { from: result.from, to: result.to };
    foundSquare = null;

    render();
    updateUI();

    const message =
      `${result.color === "w" ? "White" : "Black"} ` +
      `${NAMES[result.piece]} ${result.from} to ${result.to}` +
      (result.captured ? " capturing " + NAMES[result.captured] : "") +
      (result.promotion ? " promoting to " + NAMES[result.promotion] : "") +
      ".";

    setStatus(message + " " + gameStatus());
    say(message + " " + gameStatus());

    return true;
  }

  function gameStatus() {
    if (game.in_checkmate()) return "Checkmate.";
    if (game.in_draw()) return "Draw.";

    if (game.in_check()) {
      return `${game.turn() === "w" ? "White" : "Black"} is in check.`;
    }

    return `${game.turn() === "w" ? "White" : "Black"} to move.`;
  }

  function updateUI() {
    $("turnLabel").textContent = game.game_over()
      ? "Game over"
      : `${game.turn() === "w" ? "White" : "Black"} to move`;

    $("gameLabel").textContent = gameStatus();

    const hist = game.history();

    if (!hist.length) {
      $("history").innerHTML = "<li>No moves yet.</li>";
    } else {
      let rows = "";

      for (let i = 0; i < hist.length; i += 2) {
        rows +=
          `<li><strong>${Math.floor(i / 2) + 1}.</strong> ${hist[i]}` +
          (hist[i + 1] ? ` &nbsp; ${hist[i + 1]}` : "") +
          "</li>";
      }

      $("history").innerHTML = rows;
    }
  }

  function setStatus(message) {
    $("status").textContent = message;
  }

  function say(text) {
    if (!("speechSynthesis" in window)) return;

    if ($("speechSynthCheck") && !$("speechSynthCheck").checked) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.lang = "en-US";

    window.speechSynthesis.speak(utterance);
  }

  function findKing(color) {
    const board = game.board();

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];

        if (p && p.type === "k" && p.color === color) {
          const sq = "abcdefgh"[c] + (8 - r);

          foundSquare = sq;
          render();

          const msg =
            `Your ${color === "w" ? "white" : "black"} king is on ${sq}. ` +
            "The square is highlighted in gold.";

          setStatus(msg);
          say(msg);
          return;
        }
      }
    }
  }

  function describeBoard() {
    const side = game.turn() === "w" ? "White" : "Black";
    const pieces = [];

    for (const sq of squareOrder()) {
      const p = game.get(sq);

      if (p) {
        pieces.push(
          `${p.color === "w" ? "White" : "Black"} ${NAMES[p.type]} on ${sq}`
        );
      }
    }

    const msg =
      `${side} to move. ${gameStatus()} ` +
      `There are ${pieces.length} pieces on the board. ` +
      pieces.join(". ") + ".";

    setStatus(msg);
    say(msg);
  }

  function legalMoves() {
    const moves = game.moves({ verbose: true });

    if (!moves.length) {
      const msg = "There are no legal moves.";
      setStatus(msg);
      say(msg);
      return;
    }

    const msg =
      `Legal moves for ${game.turn() === "w" ? "White" : "Black"}: ` +
      moves.map(m => `${NAMES[m.piece]} ${m.from} to ${m.to}`).join("; ") +
      ".";

    setStatus(msg);
    say(msg);
  }

  function normal(s) {
    return s.toLowerCase()
      .replace(/[.,!?;:]/g, " ")
      .replace(/\bplease\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const FILE_WORDS = {
    a: "a", alpha: "a",
    b: "b", bravo: "b",
    c: "c", charlie: "c",
    d: "d", delta: "d",
    e: "e", echo: "e",
    f: "f", foxtrot: "f",
    g: "g", golf: "g",
    h: "h", hotel: "h"
  };

  const NUM_WORDS = {
    one: "1", two: "2", three: "3", four: "4",
    five: "5", six: "6", seven: "7", eight: "8"
  };

  function cleanSquareWords(s) {
    return s
      .replace(
        /\b(alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel)\s+(one|two|three|four|five|six|seven|eight)\b/g,
        (_, f, n) => FILE_WORDS[f] + NUM_WORDS[n]
      )
      .replace(
        /\b([a-h])\s+(one|two|three|four|five|six|seven|eight)\b/g,
        (_, f, n) => f + NUM_WORDS[n]
      );
  }

  function handleCommand(raw) {
    const s = normal(cleanSquareWords(raw));
    if (!s) return;

    $("heardText").textContent = `Heard: “${raw}”`;

    if (/\b(help|commands|what can i say)\b/.test(s)) {
      const msg =
        "Say a move like e4, knight f3, or move e2 to e4. " +
        "You can also say where is my king, describe the board, " +
        "what can I move, undo, new game, read last move, or stop talking.";

      setStatus(msg);
      say(msg);
      return;
    }

    if (/\b(stop talking|be quiet|silence|stop speech)\b/.test(s)) {
      window.speechSynthesis?.cancel();
      setStatus("Speech stopped.");
      return;
    }

    if (/\b(where is|locate|find)\b/.test(s) && /\bking\b/.test(s)) {
      let color = game.turn();

      if (/\b(black|opponent|their)\b/.test(s)) color = "b";
      else if (/\b(white|my|your)\b/.test(s)) color = "w";

      findKing(color);
      return;
    }

    if (
      /\b(describe|read|tell me about|what is on)\b/.test(s) &&
      /\b(board|position|pieces)\b/.test(s)
    ) {
      describeBoard();
      return;
    }

    if (/\b(what can i move|legal moves|available moves|possible moves)\b/.test(s)) {
      legalMoves();
      return;
    }

    if (/\b(undo|take back|retract)\b/.test(s)) {
      const m = game.undo();

      if (m) {
        lastMove = null;
        foundSquare = null;
        selected = null;

        render();
        updateUI();

        const msg =
          `Undid ${m.san}. ${game.turn() === "w" ? "White" : "Black"} to move.`;

        setStatus(msg);
        say(msg);
      } else {
        setStatus("There is no move to undo.");
      }

      return;
    }

    if (/\b(new game|restart|reset board|start over)\b/.test(s)) {
      game.reset();
      selected = null;
      lastMove = null;
      foundSquare = null;

      render();
      updateUI();

      setStatus("New game. White to move.");
      say("New game. White to move.");
      return;
    }

    if (/\b(read last move|last move|what was the last move)\b/.test(s)) {
      const h = game.history();

      const msg = h.length
        ? `Last move was ${h[h.length - 1]}.`
        : "No moves have been played yet.";

      setStatus(msg);
      say(msg);
      return;
    }

    if (/\b(flip board|rotate board)\b/.test(s)) {
      flipped = !flipped;
      render();

      setStatus(
        `Board flipped. ${game.turn() === "w" ? "White" : "Black"} to move.`
      );

      say("Board flipped.");
      return;
    }

    if (/\b(start listening|listen)\b/.test(s)) {
      startListening();
      return;
    }

    if (/\b(stop listening|turn off microphone)\b/.test(s)) {
      stopListening();
      return;
    }

    // Coordinate moves: "e2 to e4", "move e2 e4", or "e2-e4".
    const coords = s.match(
      /\b([a-h][1-8])\s*(?:to|two|into|[-,])\s*([a-h][1-8])\b/
    );

    if (coords) {
      makeMove(coords[1], coords[2]);
      return;
    }

    // Spoken piece and destination, such as "knight f3".
    const words = s
      .replace(/^(move|play|make|please move)\s+/, "")
      .replace(/\s+(please|now)$/, "")
      .trim();

    const pieceMatch = words.match(
      /\b(king|queen|rook|bishop|knight|pawn)\s+(?:to\s+)?([a-h][1-8])\b/
    );

    if (pieceMatch) {
      const pieceType = {
        king: "k",
        queen: "q",
        rook: "r",
        bishop: "b",
        knight: "n",
        pawn: "p"
      }[pieceMatch[1]];

      const to = pieceMatch[2];

      const candidates = game.moves({ verbose: true }).filter(
        m => m.piece === pieceType && m.to === to
      );

      if (candidates.length === 1) {
        makeMove(candidates[0].from, to);
        return;
      }

      if (candidates.length > 1) {
        const msg =
          `More than one ${pieceMatch[1]} can move to ${to}. ` +
          `Say the starting square, for example move g1 to f3.`;

        setStatus(msg);
        say(msg);
        return;
      }
    }

    // Standard chess notation, including e4, Nf3 and castling.
    const sanCandidate = words
      .replace(/\b(castle kingside|castle king side)\b/g, "O-O")
      .replace(/\b(castle queenside|castle queen side)\b/g, "O-O-O");

    const possible = game.moves();

    const exact = possible.find(
      m => m.toLowerCase() === sanCandidate.replace(/0/g, "o").toLowerCase()
    );

    if (exact) {
      const result = game.move(exact);

      lastMove = { from: result.from, to: result.to };
      foundSquare = null;

      render();
      updateUI();

      const msg =
        `${result.color === "w" ? "White" : "Black"} played ` +
        `${result.san}. ${gameStatus()}`;

      setStatus(msg);
      say(msg);
      return;
    }

    const msg =
      `I heard “${raw}”, but couldn't match it to a legal move or command. ` +
      `Try “e4”, “knight f3”, or say “help”.`;

    setStatus(msg);
    say(msg);
  }

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SR) {
      setStatus(
        "Speech recognition is not supported here. Use Chrome or Edge, " +
        "or type a command in the command box."
      );

      say("Speech recognition is not supported in this browser.");
      return;
    }

    if (listening) return;

    try {
      if (!recognition) {
        recognition = new SR();
        recognition.lang = "en-US";
        recognition.interimResults = false;
        recognition.continuous = false;
        recognition.maxAlternatives = 3;

        recognition.onresult = e => {
          const transcript =
            e.results[e.results.length - 1][0].transcript;

          handleCommand(transcript);
        };

        recognition.onerror = e => {
          setStatus(
            e.error === "not-allowed"
              ? "Microphone permission was denied. Allow microphone access in the browser address bar."
              : `Speech recognition error: ${e.error}. Try again or type a command.`
          );
        };

        recognition.onend = () => {
          listening = false;
          setMicState(false);
        };
      }

      recognition.start();
      listening = true;
      setMicState(true);

      setStatus("Listening… say a chess move or ask a question.");
      $("micBtn").setAttribute("aria-pressed", "true");
    } catch (e) {
      setStatus("Could not start listening. Wait a moment and try again.");
      listening = false;
      setMicState(false);
    }
  }

  function stopListening() {
    if (recognition && listening) {
      recognition.stop();
    }

    listening = false;
    setMicState(false);
    setStatus("Microphone stopped.");
  }

  function setMicState(on) {
    $("micState").textContent = on ? "Listening…" : "Microphone off";

    $("micBtn").textContent = on
      ? "⏹ Stop listening"
      : "🎙 Start listening";

    $("micBtn").classList.toggle("listening", on);
    $("micBtn").setAttribute("aria-pressed", String(on));
  }

  // Button and keyboard events.
  $("micBtn").addEventListener("click", () => {
    listening ? stopListening() : startListening();
  });

  $("sendBtn").addEventListener("click", () => {
    const value = $("commandInput").value;
    $("commandInput").value = "";
    handleCommand(value);
  });

  $("commandInput").addEventListener("keydown", e => {
    if (e.key === "Enter") $("sendBtn").click();
  });

  $("undoBtn").addEventListener("click", () => handleCommand("undo"));

  $("resetBtn").addEventListener("click", () => handleCommand("new game"));

  $("repeatBtn").addEventListener("click", () => {
    say($("status").textContent);
  });

  $("flipBtn").addEventListener("click", () => {
    flipped = !flipped;
    render();
  });

  document.addEventListener("keydown", e => {
    if (
      e.code === "Space" &&
      !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
    ) {
      e.preventDefault();
      listening ? stopListening() : startListening();
    }

    if (e.key === "Escape") {
      selected = null;
      foundSquare = null;
      render();
    }
  });

  if ("speechSynthesis" in window) {
    $("engineBadge").textContent = "Voice output available";
  }

  initGame();
})();