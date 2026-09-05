/* Castle Road — the page. Draws the board, plays the animations, and talks to
   the server over server-sent events. */
(function () {
  "use strict";

  var R = window.CastleRules;
  var FINISH = R.FINISH, COUNT = R.COUNT, SPECIALS = R.SPECIALS;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var HAND = '"Patrick Hand", "Bradley Hand", cursive';
  var ROAD_W = 96;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var roadInk = document.getElementById("roadInk");
  var roadFill = document.getElementById("roadFill");
  var centers = [];

  /* ---------- who am I, which game ---------- */
  var token = localStorage.getItem("castleroad.token");
  if (!token) {
    token = "t" + Math.random().toString(36).slice(2, 12);
    try { localStorage.setItem("castleroad.token", token); } catch (e) {}
  }

  var room = (location.hash || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
  var mine = [];
  function mineKey() { return "castleroad.mine." + room; }
  function loadMine() {
    try { mine = JSON.parse(localStorage.getItem(mineKey()) || "[]") || []; } catch (e) { mine = []; }
  }
  function saveMine() { try { localStorage.setItem(mineKey(), JSON.stringify(mine)); } catch (e) {} }

  var state = null, online = {}, seenSeq = -1, animating = false, connected = false;
  var display = {};

  /* ---------- little helpers ---------- */
  function el(name, attrs, text) {
    var n = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function tone(name) {
    return getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim() || "#000";
  }
  function safeColor(c) { return /^#[0-9a-fA-F]{6}$/.test(String(c)) ? c : "#5D6679"; }
  function msg(text, warn) {
    var m = document.getElementById("msg");
    m.textContent = text || "";
    m.className = "msg" + (warn ? " warn" : "");
  }

  /* ---------- drawing the road ---------- */
  function smoothPath(pts) {
    var d = "M " + pts[0][0] + " " + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += " C " + c1x.toFixed(1) + " " + c1y.toFixed(1) + " " + c2x.toFixed(1) + " " + c2y.toFixed(1) +
           " " + p2[0] + " " + p2[1];
    }
    return d;
  }
  function at(len) {
    var total = roadInk.getTotalLength();
    return roadInk.getPointAtLength(Math.max(0, Math.min(len, total)));
  }
  function angleAt(len) {
    var a = at(len - 4), b = at(len + 4);
    var deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    return deg;
  }
  function crown(x, y, fill, deg) {
    var g = el("g", {transform: "translate(" + x + "," + y + ") rotate(" + (-(deg || 0)).toFixed(1) + ") scale(0.92)"});
    g.appendChild(el("path", {d: "M -22 8 L -22 -10 L -11 -1 L 0 -14 L 11 -1 L 22 -10 L 22 8 Z",
      fill: "none", stroke: fill, "stroke-width": 3.5, "stroke-linejoin": "round"}));
    g.appendChild(el("path", {d: "M -22 13 L 22 13", stroke: fill, "stroke-width": 3.5, "stroke-linecap": "round"}));
    return g;
  }
  function heart(x, y, fill, deg) {
    var g = el("g", {transform: "translate(" + x + "," + y + ") rotate(" + (-(deg || 0)).toFixed(1) + ") scale(0.92)"});
    g.appendChild(el("path", {d: "M 0 12 C -18 0 -20 -12 -10 -14 C -4 -15 -1 -10 0 -8 C 1 -10 4 -15 10 -14 C 20 -12 18 0 0 12 Z",
      fill: "none", stroke: fill, "stroke-width": 3.2, "stroke-linejoin": "round"}));
    return g;
  }

  function drawBoard() {
    var d = smoothPath(R.WAY);
    roadInk.setAttribute("d", d);
    roadFill.setAttribute("d", d);
    roadInk.setAttribute("stroke", tone("ink"));
    roadInk.setAttribute("stroke-width", ROAD_W + 6);
    roadFill.setAttribute("stroke", tone("paper-2"));
    roadFill.setAttribute("stroke-width", ROAD_W);

    var L = roadInk.getTotalLength(), step = L / COUNT, i;
    for (i = 0; i < COUNT; i++) centers[i] = (i + 0.5) * step;

    var divs = document.getElementById("dividers");
    var marks = document.getElementById("marks");
    var nums = document.getElementById("numbers");
    divs.textContent = ""; marks.textContent = ""; nums.textContent = "";

    for (i = 1; i < COUNT; i++) {
      var l = i * step, p = at(l), a = angleAt(l) * Math.PI / 180;
      var nx = -Math.sin(a) * (ROAD_W / 2 + 2), ny = Math.cos(a) * (ROAD_W / 2 + 2);
      divs.appendChild(el("line", {
        x1: (p.x - nx).toFixed(1), y1: (p.y - ny).toFixed(1),
        x2: (p.x + nx).toFixed(1), y2: (p.y + ny).toFixed(1),
        stroke: tone("ink"), "stroke-width": 3, "stroke-linecap": "round"
      }));
    }

    for (i = 0; i < COUNT; i++) {
      var pt = at(centers[i]), deg = angleAt(centers[i]);
      var g = el("g", {transform: "translate(" + pt.x.toFixed(1) + "," + pt.y.toFixed(1) + ") rotate(" + deg.toFixed(1) + ")"});

      if (i === 0) {
        g.appendChild(el("text", {x: 0, y: -6, "text-anchor": "middle", fill: tone("ink"), "font-family": HAND, "font-size": 25}, "START"));
        g.appendChild(el("text", {x: 0, y: 22, "text-anchor": "middle", fill: tone("ink-soft"), "font-family": HAND, "font-size": 19}, "here"));
      } else if (i === FINISH) {
        g.appendChild(el("text", {x: 0, y: 10, "text-anchor": "middle", fill: tone("felt"), "font-family": HAND, "font-size": 29}, "FINISH"));
      } else {
        var sp = SPECIALS[i];
        if (sp) {
          if (sp.mark === "castle") g.appendChild(crown(0, -7, tone("felt"), deg));
          else if (sp.mark === "heart") g.appendChild(heart(0, -7, tone("felt"), deg));
          else g.appendChild(el("text", {x: 0, y: 1, "text-anchor": "middle", fill: tone(sp.tone),
                "font-family": HAND, "font-size": (sp.mark.length > 4 ? 20 : 29)}, sp.mark));
          g.appendChild(el("text", {x: 0, y: 33, "text-anchor": "middle", fill: tone("pencil"), "font-family": HAND, "font-size": 18}, String(i)));
        } else {
          g.appendChild(el("text", {x: 0, y: 12, "text-anchor": "middle", fill: tone("ink"), "font-family": HAND, "font-size": 32}, String(i)));
        }
      }
      (i === 0 || i === FINISH || SPECIALS[i] ? marks : nums).appendChild(g);
    }
  }

  /* ---------- pieces ---------- */
  function lenFor(v) {
    var i = Math.max(0, Math.min(FINISH, Math.floor(v)));
    var j = Math.min(FINISH, i + 1);
    var f = Math.max(0, Math.min(1, v - i));
    return centers[i] + (centers[j] - centers[i]) * f;
  }

  function drawTokens() {
    var layer = document.getElementById("tokens");
    layer.textContent = "";
    if (!state) return;
    var bySpace = {}, used = {};
    state.players.forEach(function (p) {
      var v = display[p.id] === undefined ? p.pos : display[p.id];
      var key = Math.round(v);
      bySpace[key] = (bySpace[key] || 0) + 1;
    });
    state.players.forEach(function (p) {
      var v = display[p.id] === undefined ? p.pos : display[p.id];
      var key = Math.round(v), total = bySpace[key];
      var idx = (used[key] = (used[key] || 0)); used[key]++;
      var pt = at(lenFor(v)), ox = 0, oy = 0;
      if (total > 1) {
        var ang = (Math.PI * 2 * idx / total) - Math.PI / 2;
        ox = Math.cos(ang) * 19; oy = Math.sin(ang) * 17;
      }
      var g = el("g", {transform: "translate(" + (pt.x + ox).toFixed(1) + "," + (pt.y + oy).toFixed(1) + ")", filter: "url(#pawnShadow)"});
      g.appendChild(el("circle", {r: 22, fill: safeColor(p.color), stroke: tone("ink"), "stroke-width": 3}));
      g.appendChild(el("text", {x: 0, y: 8, "text-anchor": "middle", "font-size": 22}, p.emoji));
      layer.appendChild(g);
    });
  }

  function pip(svgEl, n) {
    svgEl.textContent = "";
    var map = {1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]],
               4: [[28, 28], [72, 28], [28, 72], [72, 72]],
               5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
               6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]]};
    (map[n] || []).forEach(function (c) { svgEl.appendChild(el("circle", {cx: c[0], cy: c[1], r: 9})); });
  }

  /* ---------- the side panel ---------- */
  function playerById(id) {
    if (!state) return null;
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i];
    return null;
  }
  function current() {
    return state && state.players.length ? state.players[state.turn % state.players.length] : null;
  }
  function isMine(p) { return p && mine.indexOf(p.id) !== -1; }

  function renderPanel() {
    var list = document.getElementById("playerList");
    var cur = current();
    list.textContent = "";

    if (!state || !state.players.length) {
      var li0 = document.createElement("li");
      var sp0 = document.createElement("span");
      sp0.className = "pname"; sp0.style.color = "var(--pencil)";
      sp0.textContent = "Nobody yet — take a seat.";
      li0.appendChild(sp0); list.appendChild(li0);
    } else {
      state.players.forEach(function (p) {
        var li = document.createElement("li");
        if (cur && p.id === cur.id && state.status === "playing") li.className = "now";
        if (p.done) li.className += " done";

        var pawn = document.createElement("span");
        pawn.className = "pawn"; pawn.style.background = safeColor(p.color); pawn.textContent = p.emoji;

        var nm = document.createElement("span");
        nm.className = "pname"; nm.textContent = p.name;
        if (isMine(p)) {
          var y = document.createElement("span");
          y.className = "you"; y.textContent = " (you)";
          nm.appendChild(y);
        }

        var pos = document.createElement("span");
        pos.className = "ppos";
        pos.textContent = p.done ? ("🏁 " + (p.rank === 1 ? "1st" : p.rank + "th")) : (p.pos === 0 ? "start" : p.pos);

        var dot = document.createElement("span");
        var here = online[p.id];
        dot.className = "dot" + (here ? "" : " off");
        dot.title = here ? "on the page now" : "not on the page";

        li.appendChild(pawn); li.appendChild(nm); li.appendChild(pos); li.appendChild(dot);
        list.appendChild(li);
      });
    }

    var logEl = document.getElementById("log");
    logEl.textContent = "";
    ((state && state.log) || []).slice(-14).forEach(function (entry) {
      var li = document.createElement("li");
      li.innerHTML = entry;                 /* names are escaped on the server */
      logEl.appendChild(li);
    });
    logEl.scrollTop = logEl.scrollHeight;

    var turnLine = document.getElementById("turnLine");
    var sub = document.createElement("small");
    var roll = document.getElementById("rollBtn");
    var banner = document.getElementById("banner");
    banner.className = "banner";

    if (!connected) {
      turnLine.textContent = "Reconnecting…";
      sub.textContent = "The board will catch up on its own.";
      roll.disabled = true; roll.textContent = "Roll the dice";
    } else if (!state || !state.players.length) {
      turnLine.textContent = "Waiting for players";
      sub.textContent = "Send the invite link to whoever's playing.";
      roll.disabled = true; roll.textContent = "Roll the dice";
    } else if (state.status === "done") {
      var w = playerById(state.winner);
      turnLine.textContent = "🏁 " + (w ? w.name : "Somebody") + " wins!";
      sub.textContent = "Start a new game whenever you like.";
      banner.textContent = (w ? w.emoji + " " + w.name : "") + " reached the finish!";
      banner.className = "banner show";
      roll.disabled = true; roll.textContent = "Game over";
    } else if (state.status === "lobby") {
      turnLine.textContent = "Ready when you are";
      sub.textContent = state.players.length < 2 ? "One more player would be good." : state.players.length + " players in.";
      roll.disabled = animating || !mine.length;
      roll.textContent = "Start the game";
    } else if (cur) {
      var yours = isMine(cur);
      turnLine.textContent = yours ? "Your turn, " + cur.name : cur.name + "’s turn";
      sub.textContent = yours ? "Roll and move." : "Waiting for " + cur.name + " to roll…";
      roll.disabled = !yours || animating;
      roll.textContent = yours ? "Roll the dice" : "Waiting…";
    }
    turnLine.appendChild(sub);

    var dice = (state && state.last && state.last.dice) || [1, 1];
    pip(document.getElementById("die1"), dice[0]);
    pip(document.getElementById("die2"), dice[1]);
    document.getElementById("liveDot").className = "live" + (connected ? " on" : "");
    drawTokens();
  }

  /* ---------- animation ---------- */
  function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

  function glide(pid, from, to, dur) {
    return new Promise(function (done) {
      if (reduce || dur <= 0) { display[pid] = to; drawTokens(); done(); return; }
      var t0 = performance.now();
      (function frame(now) {
        var k = Math.min(1, (now - t0) / dur);
        display[pid] = from + (to - from) * ease(k);
        drawTokens();
        if (k < 1) requestAnimationFrame(frame);
        else { display[pid] = to; drawTokens(); done(); }
      })(t0);
    });
  }

  function walk(pid, from, to) {
    if (to === from) return glide(pid, from, to, 0);
    var seq = Promise.resolve(), dir = to > from ? 1 : -1;
    var per = Math.max(90, Math.min(210, 1400 / Math.max(1, Math.abs(to - from))));
    for (var s = from + dir; ; s += dir) {
      (function (target) {
        seq = seq.then(function () { return glide(pid, target - dir, target, per); });
      })(s);
      if (s === to || Math.abs(s - from) > 40) break;
    }
    return seq;
  }

  function playAction(act) {
    animating = true;
    renderPanel();
    var pid = act.playerId;
    var d1 = document.getElementById("die1"), d2 = document.getElementById("die2");
    d1.classList.add("rolling"); d2.classList.add("rolling");

    return new Promise(function (r) { setTimeout(r, reduce ? 0 : 620); }).then(function () {
      d1.classList.remove("rolling"); d2.classList.remove("rolling");
      pip(d1, act.dice[0]); pip(d2, act.dice[1]);
      var chain = Promise.resolve(), prev = act.from;
      act.steps.forEach(function (target, i) {
        (function (p, t, jump) {
          chain = chain.then(function () { return jump ? glide(pid, p, t, 620) : walk(pid, p, t); });
        })(prev, target, i > 0);
        prev = target;
      });
      return chain;
    }).then(function () {
      animating = false;
      renderPanel();
      if (state && state.status === "done") celebrate();
    });
  }

  /* ---------- talking to the server ---------- */
  function send(type, extra) {
    var body = Object.assign({type: type, room: room, token: token}, extra || {});
    return fetch("/api/action", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {error: "The server said something unexpected."}; })
        .then(function (data) {
          if (!res.ok || data.error) throw new Error(data.error || "That didn't work.");
          return data;
        });
    });
  }

  var source = null;
  function connect() {
    if (source) source.close();
    source = new EventSource("/api/events?room=" + encodeURIComponent(room) + "&token=" + encodeURIComponent(token));
    source.onopen = function () { connected = true; msg(""); renderPanel(); };
    source.onerror = function () { connected = false; renderPanel(); };
    source.onmessage = function (ev) {
      var payload;
      try { payload = JSON.parse(ev.data); } catch (e) { return; }
      connected = true;
      online = {};
      (payload.online || []).forEach(function (id) { online[id] = true; });
      applyState(payload.state);
    };
  }

  function applyState(s) {
    var first = (state === null);
    state = s || {players: [], turn: 0, status: "lobby", seq: 0, last: null, log: []};
    state.players = state.players || [];

    /* forget seats that no longer exist (a reset room, someone removed) */
    var ids = state.players.map(function (p) { return p.id; });
    var kept = mine.filter(function (id) { return ids.indexOf(id) !== -1; });
    if (kept.length !== mine.length) { mine = kept; saveMine(); }

    state.players.forEach(function (p) { if (display[p.id] === undefined) display[p.id] = p.pos; });

    var act = state.last;
    var isNew = !first && state.seq > seenSeq && act && act.at && (Date.now() - act.at) < 30000;
    seenSeq = state.seq;

    if (first) {
      state.players.forEach(function (p) { display[p.id] = p.pos; });
      renderPanel();
      if (!mine.length) openJoin();
      return;
    }
    if (isNew && !animating) {
      display[act.playerId] = act.from;
      renderPanel();
      playAction(act);
    } else if (!animating) {
      state.players.forEach(function (p) { display[p.id] = p.pos; });
      renderPanel();
    } else {
      renderPanel();
    }
  }

  /* ---------- confetti ---------- */
  function celebrate() {
    if (reduce) return;
    var c = document.getElementById("confetti"), ctx = c.getContext("2d");
    c.width = innerWidth; c.height = innerHeight;
    var cols = [tone("felt"), tone("gold"), tone("biro"), tone("moss")], bits = [], i;
    for (i = 0; i < 140; i++) bits.push({
      x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.6,
      vy: 2 + Math.random() * 3.6, vx: -1.2 + Math.random() * 2.4,
      s: 5 + Math.random() * 7, r: Math.random() * Math.PI, vr: -0.13 + Math.random() * 0.26,
      col: cols[i % cols.length]
    });
    var t0 = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, c.width, c.height);
      bits.forEach(function (b) {
        b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.fillStyle = b.col; ctx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.65); ctx.restore();
      });
      if (now - t0 < 4200) requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
    })(t0);
  }

  /* ---------- dialogs ---------- */
  var joinDlg = document.getElementById("joinDlg");
  var picked = R.PIECES[0];

  function openJoin() {
    var picker = document.getElementById("emojiPicker");
    picker.textContent = "";
    var taken = ((state && state.players) || []).map(function (p) { return p.emoji; });
    var free = R.PIECES.filter(function (p) { return taken.indexOf(p.emoji) === -1; });
    if (!free.length) free = R.PIECES.slice();
    picked = free[0];
    free.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "pick"; b.textContent = p.emoji;
      b.style.background = p.color + "22";
      b.setAttribute("aria-pressed", p === picked ? "true" : "false");
      b.setAttribute("aria-label", "Choose piece " + p.emoji);
      b.addEventListener("click", function () {
        picked = p;
        Array.prototype.forEach.call(picker.children, function (k) { k.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
      });
      picker.appendChild(b);
    });
    if (typeof joinDlg.showModal === "function") joinDlg.showModal();
    setTimeout(function () { document.getElementById("nameIn").focus(); }, 30);
  }

  document.getElementById("joinForm").addEventListener("submit", function (ev) {
    var val = ev.submitter && ev.submitter.value;
    var name = document.getElementById("nameIn").value.trim();
    if (val !== "join" || !name) return;
    document.getElementById("nameIn").value = "";
    send("join", {name: name.slice(0, 16), emoji: picked.emoji}).then(function (data) {
      if (data.playerId) { mine.push(data.playerId); saveMine(); renderPanel(); }
    }).catch(function (err) { msg(err.message, true); });
  });

  var rulesDlg = document.getElementById("rulesDlg");
  document.getElementById("rulesBtn").addEventListener("click", function () {
    var ul = document.getElementById("rulesList");
    ul.textContent = "";
    Object.keys(SPECIALS).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
      var li = document.createElement("li");
      var sq = document.createElement("span"); sq.className = "sq"; sq.textContent = n;
      var tx = document.createElement("span"); tx.textContent = SPECIALS[n].desc;
      li.appendChild(sq); li.appendChild(tx); ul.appendChild(li);
    });
    var last = document.createElement("li");
    var sq2 = document.createElement("span"); sq2.className = "sq"; sq2.textContent = "36";
    var tx2 = document.createElement("span"); tx2.textContent = "Finish — first one here wins.";
    last.appendChild(sq2); last.appendChild(tx2); ul.appendChild(last);
    if (typeof rulesDlg.showModal === "function") rulesDlg.showModal();
  });
  document.getElementById("rulesClose").addEventListener("click", function () { rulesDlg.close(); });

  var inviteDlg = document.getElementById("inviteDlg");
  document.getElementById("inviteBtn").addEventListener("click", function () {
    var link = location.origin + location.pathname + "#" + room;
    document.getElementById("inviteLink").value = link;
    document.getElementById("copyMsg").textContent = "";
    if (typeof inviteDlg.showModal === "function") inviteDlg.showModal();
  });
  document.getElementById("copyBtn").addEventListener("click", function () {
    var field = document.getElementById("inviteLink");
    var done = function () { document.getElementById("copyMsg").textContent = "Copied — paste it to them."; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(field.value).then(done, function () { field.select(); });
    } else { field.select(); document.execCommand("copy"); done(); }
  });
  document.getElementById("inviteClose").addEventListener("click", function () { inviteDlg.close(); });

  document.getElementById("addBtn").addEventListener("click", openJoin);

  document.getElementById("rollBtn").addEventListener("click", function () {
    if (!state) return;
    var action = state.status === "lobby" ? "start" : "roll";
    send(action).catch(function (err) { msg(err.message, true); });
  });

  document.getElementById("newBtn").addEventListener("click", function () {
    if (!confirm("Start a brand new game? Everyone goes back to Start.")) return;
    Object.keys(display).forEach(function (k) { display[k] = 0; });
    send("reset").catch(function (err) { msg(err.message, true); });
  });

  /* ---------- boot ---------- */
  var landing = document.getElementById("landingDlg");

  function begin() {
    loadMine();
    document.getElementById("roomCode").textContent = room;
    document.title = "Castle Road · " + room;
    connect();
  }

  document.getElementById("createBtn").addEventListener("click", function () {
    fetch("/api/new").then(function (res) { return res.json(); }).then(function (data) {
      if (!data.code) throw new Error("no code");
      location.hash = data.code;
      room = data.code;
      landing.close();
      begin();
    }).catch(function () { msg("Couldn't reach the server — is it running?", true); });
  });

  document.getElementById("codeForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var code = document.getElementById("codeIn").value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
    if (!code) return;
    location.hash = code;
    room = code;
    landing.close();
    begin();
  });

  window.addEventListener("hashchange", function () {
    var next = (location.hash || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
    if (next && next !== room) location.reload();
  });
  window.addEventListener("resize", drawTokens);
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var repaint = function () { drawBoard(); drawTokens(); };
    if (mq.addEventListener) mq.addEventListener("change", repaint);
    else if (mq.addListener) mq.addListener(repaint);
  }

  drawBoard();
  renderPanel();
  if (room) begin();
  else if (typeof landing.showModal === "function") landing.showModal();
})();
