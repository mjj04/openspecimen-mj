/* Castle Road — a tiny game server.
   No database, no accounts, no dependencies: rooms live in memory, are pushed
   to every open page over server-sent events, and are saved to a JSON file so
   a restart doesn't lose a game in progress. */
"use strict";

var http = require("http");
var fs   = require("fs");
var path = require("path");
var R    = require("./public/game-rules.js");

var PORT      = Number(process.env.PORT) || 3000;
var PUBLIC    = path.join(__dirname, "public");
var DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "rooms.json");

var MAX_PLAYERS   = 8;
var MAX_ROOMS     = 500;
var ROOM_TTL_MS   = 24 * 60 * 60 * 1000;
var BODY_LIMIT    = 8 * 1024;
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I/O/0/1

var rooms = new Map();   // code -> room
var dirty = false;

/* ---------- rooms ---------- */

function freshState() {
  return {players: [], turn: 0, status: "lobby", seq: 0, last: null, winner: null, log: []};
}

function newRoom(code) {
  return {code: code, state: freshState(), owners: {}, clients: new Set(), touched: Date.now()};
}

function makeCode() {
  var code;
  do {
    code = "";
    for (var i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}

function getRoom(code, create) {
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (!code) return null;
  var room = rooms.get(code);
  if (!room && create) {
    if (rooms.size >= MAX_ROOMS) sweep(true);
    if (rooms.size >= MAX_ROOMS) return null;
    room = newRoom(code);
    rooms.set(code, room);
    dirty = true;
  }
  if (room) room.touched = Date.now();
  return room || null;
}

function onlineIds(room) {
  var live = {};
  room.clients.forEach(function (c) {
    (room.owners[c.token] || []).forEach(function (pid) { live[pid] = true; });
  });
  return Object.keys(live);
}

function broadcast(room) {
  var frame = "data: " + JSON.stringify({state: room.state, online: onlineIds(room)}) + "\n\n";
  room.clients.forEach(function (c) {
    try { c.res.write(frame); } catch (e) { room.clients.delete(c); }
  });
}

/* ---------- the turn itself ---------- */

function esc(t) {
  return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
    return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
  });
}

function nextTurnIndex(s, fromIdx) {
  for (var k = 1; k <= s.players.length; k++) {
    var i = (fromIdx + k) % s.players.length;
    if (!s.players[i].done) return i;
  }
  return fromIdx;
}

function owns(room, token, playerId) {
  return (room.owners[token] || []).indexOf(playerId) !== -1;
}

var ACTIONS = {
  join: function (room, body, token) {
    var s = room.state;
    if (s.players.length >= MAX_PLAYERS) return {error: "This game is full — eight players is the limit."};
    var name = String(body.name || "").trim().slice(0, 16);
    if (!name) return {error: "A name is needed to take a seat."};

    var taken = s.players.map(function (p) { return p.emoji; });
    var piece = R.PIECES.filter(function (p) { return taken.indexOf(p.emoji) === -1; })[0]
             || R.PIECES[s.players.length % R.PIECES.length];
    if (body.emoji) {
      var wanted = R.PIECES.filter(function (p) { return p.emoji === body.emoji && taken.indexOf(p.emoji) === -1; })[0];
      if (wanted) piece = wanted;
    }

    var player = {
      id: "p" + Math.random().toString(36).slice(2, 9),
      name: name, emoji: piece.emoji, color: piece.color,
      pos: 0, done: false, rank: 0
    };
    s.players.push(player);
    s.seq++;
    s.log = s.log.concat(["<b>" + esc(name) + "</b> " + piece.emoji + " sat down."]).slice(-60);
    room.owners[token] = (room.owners[token] || []).concat([player.id]);
    return {playerId: player.id};
  },

  leave: function (room, body, token) {
    var s = room.state, pid = String(body.playerId || "");
    if (!owns(room, token, pid)) return {error: "That piece isn't yours to take off the board."};
    var gone = s.players.filter(function (p) { return p.id === pid; })[0];
    if (!gone) return {};
    s.players = s.players.filter(function (p) { return p.id !== pid; });
    room.owners[token] = room.owners[token].filter(function (id) { return id !== pid; });
    if (s.turn >= s.players.length) s.turn = 0;
    if (!s.players.length) { s.status = "lobby"; s.last = null; }
    s.seq++;
    s.log = s.log.concat(["<b>" + esc(gone.name) + "</b> left the game."]).slice(-60);
    return {};
  },

  start: function (room) {
    var s = room.state;
    if (!s.players.length) return {error: "Someone needs to take a seat first."};
    if (s.status === "playing") return {};
    s.status = "playing"; s.turn = 0; s.winner = null; s.last = null; s.seq++;
    s.log = s.log.concat(["<b>Off we go!</b> " + esc(s.players[0].name) + " starts."]).slice(-60);
    return {};
  },

  roll: function (room, body, token) {
    var s = room.state;
    if (s.status !== "playing") return {error: "The game isn't running."};
    var idx = s.turn % s.players.length;
    var p = s.players[idx];
    if (!owns(room, token, p.id)) return {error: "It's " + p.name + "'s turn."};

    var from = p.pos;
    var dice = [R.d6(), R.d6()];
    var out = R.resolveTurn(from, dice);
    p.pos = out.end;

    var landed = out.steps[0];
    var logs = ["<b>" + esc(p.name) + "</b> rolled " + dice[0] + " + " + dice[1] + " = " + (dice[0] + dice[1]) +
                (landed >= R.FINISH ? " — and reaches the Finish!" : " — to space " + landed)];
    out.notes.forEach(function (n) { logs.push("&nbsp;&nbsp;↳ " + esc(n)); });
    if (out.steps.length > 1) {
      logs.push("&nbsp;&nbsp;↳ " + (out.end >= R.FINISH ? "and reaches the Finish!" : "ends on space " + out.end));
    }

    if (out.end >= R.FINISH) {
      p.done = true;
      p.rank = s.players.filter(function (q) { return q.done; }).length;
      if (p.rank === 1) {
        s.status = "done";
        s.winner = p.id;
        logs.push("<b>" + esc(p.name) + " wins Castle Road!</b>");
      }
    }
    if (s.status !== "done") s.turn = (out.again && !p.done) ? idx : nextTurnIndex(s, idx);
    if (out.again && !p.done) logs.push("&nbsp;&nbsp;↳ " + esc(p.name) + " goes again.");

    s.seq++;
    s.last = {playerId: p.id, dice: dice, from: from, steps: out.steps, at: Date.now()};
    s.log = s.log.concat(logs).slice(-60);
    return {};
  },

  reset: function (room) {
    var s = room.state;
    s.players.forEach(function (p) { p.pos = 0; p.done = false; p.rank = 0; });
    s.status = s.players.length ? "playing" : "lobby";
    s.turn = 0; s.winner = null; s.last = null; s.seq++;
    s.log = ["<b>New game.</b> Everyone back to Start."];
    return {};
  }
};

/* ---------- http ---------- */

var TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".json": "application/json"
};

function sendJSON(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"});
  res.end(body);
}

function serveStatic(req, res, pathname) {
  var rel = pathname === "/" ? "/index.html" : pathname;
  var file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (file.indexOf(PUBLIC) !== 0) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404, {"Content-Type": "text/plain"}); res.end("Not found"); return; }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": path.extname(file) === ".html" ? "no-cache" : "public, max-age=300"
    });
    res.end(data);
  });
}

var buckets = new Map();
function allowed(key) {
  var now = Date.now(), b = buckets.get(key);
  if (!b || now - b.start > 10000) { buckets.set(key, {start: now, n: 1}); return true; }
  b.n++;
  return b.n <= 40;
}

var server = http.createServer(function (req, res) {
  var url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  var p = url.pathname;

  if (p === "/health") return sendJSON(res, 200, {ok: true, rooms: rooms.size});

  /* a fresh game: mint a code */
  if (p === "/api/new") {
    var code = makeCode();
    getRoom(code, true);
    dirty = true;
    return sendJSON(res, 200, {code: code});
  }

  if (p === "/api/events") {
    var room = getRoom(url.searchParams.get("room"), true);
    if (!room) return sendJSON(res, 400, {error: "No room."});
    var token = String(url.searchParams.get("token") || "").slice(0, 40);
    if (!token) return sendJSON(res, 400, {error: "No token."});

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 3000\n\n");

    var client = {res: res, token: token};
    room.clients.add(client);
    res.write("data: " + JSON.stringify({state: room.state, online: onlineIds(room)}) + "\n\n");
    broadcast(room);

    var beat = setInterval(function () { try { res.write(": beat\n\n"); } catch (e) {} }, 25000);
    req.on("close", function () {
      clearInterval(beat);
      room.clients.delete(client);
      room.touched = Date.now();
      broadcast(room);
    });
    return;
  }

  if (p === "/api/action" && req.method === "POST") {
    var ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
    if (!allowed(ip)) return sendJSON(res, 429, {error: "Slow down a moment."});

    var chunks = "", tooBig = false;
    req.on("data", function (c) {
      chunks += c;
      if (chunks.length > BODY_LIMIT) { tooBig = true; req.destroy(); }
    });
    req.on("end", function () {
      if (tooBig) return sendJSON(res, 413, {error: "Too much data."});
      var body;
      try { body = JSON.parse(chunks || "{}"); } catch (e) { return sendJSON(res, 400, {error: "Bad request."}); }

      var room2 = getRoom(body.room, true);
      if (!room2) return sendJSON(res, 400, {error: "That game code doesn't look right."});
      var token2 = String(body.token || "").slice(0, 40);
      if (!token2) return sendJSON(res, 400, {error: "No token."});

      var fn = ACTIONS[body.type];
      if (!fn) return sendJSON(res, 400, {error: "Unknown action."});

      var out = fn(room2, body, token2) || {};
      if (out.error) return sendJSON(res, 409, {error: out.error});
      dirty = true;
      broadcast(room2);
      sendJSON(res, 200, Object.assign({ok: true}, out));
    });
    return;
  }

  serveStatic(req, res, p);
});

/* ---------- keeping games across a restart ---------- */

function save() {
  if (!dirty) return;
  dirty = false;
  var out = [];
  rooms.forEach(function (room) { out.push({code: room.code, state: room.state, owners: room.owners, touched: room.touched}); });
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), {recursive: true});
    fs.writeFileSync(DATA_FILE, JSON.stringify(out));
  } catch (e) { /* a read-only disk just means games don't survive a restart */ }
}

function load() {
  try {
    JSON.parse(fs.readFileSync(DATA_FILE, "utf8")).forEach(function (r) {
      if (Date.now() - (r.touched || 0) > ROOM_TTL_MS) return;
      var room = newRoom(r.code);
      room.state = r.state; room.owners = r.owners || {}; room.touched = r.touched;
      rooms.set(r.code, room);
    });
    console.log("Loaded " + rooms.size + " room(s).");
  } catch (e) { /* first run */ }
}

function sweep(force) {
  var now = Date.now();
  rooms.forEach(function (room, code) {
    if (room.clients.size === 0 && now - room.touched > (force ? 60 * 60 * 1000 : ROOM_TTL_MS)) {
      rooms.delete(code);
      dirty = true;
    }
  });
}

load();
setInterval(save, 10000).unref();
setInterval(sweep, 30 * 60 * 1000).unref();
["SIGINT", "SIGTERM"].forEach(function (sig) {
  process.on(sig, function () { save(); process.exit(0); });
});

server.listen(PORT, function () {
  console.log("Castle Road is running on http://localhost:" + PORT);
});
