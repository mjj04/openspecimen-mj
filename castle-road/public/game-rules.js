/* Castle Road — the board itself. Loaded by both the browser and the server,
   so the rules and the drawing can never drift apart. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CastleRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FINISH = 36;                    // 0 = Start, 1..35 numbered, 36 = Finish

  var SPECIALS = {
    4:  {kind:"again",         mark:"AGAIN!", tone:"biro", desc:"Roll again"},
    7:  {kind:"castle",        mark:"castle", tone:"felt", desc:"The red castle — roll again"},
    11: {kind:"plus",  n:3,    mark:"+3",     tone:"moss", desc:"Go on 3 spaces"},
    13: {kind:"again",         mark:"AGAIN!", tone:"biro", desc:"Roll again"},
    16: {kind:"goto",  n:20,   mark:"→20", tone:"biro", desc:"Shortcut — go to space 20"},
    18: {kind:"cuddle",        mark:"heart",  tone:"felt", desc:"Cuddle everyone!"},
    20: {kind:"castle",        mark:"castle", tone:"felt", desc:"The second castle — roll again"},
    24: {kind:"back",  n:3,    mark:"−3", tone:"plum", desc:"Go back 3 spaces"},
    28: {kind:"fork",          mark:"✻", tone:"gold", desc:"Crossroads — roll one die: 1-2 go on 1, 3-4 go on 3, 5-6 go on 5"},
    32: {kind:"plus",  n:2,    mark:"+2",     tone:"moss", desc:"Go on 2 spaces"}
  };

  /* The road, as a run of waypoints. Drawn as one smooth line, then chopped
     into 37 equal spaces. */
  var WAY = [
    [1108,102],[950,94],[790,110],[630,98],[470,112],[330,100],
    [190,145],[128,235],[168,318],
    [320,362],[480,352],[640,366],[800,356],[950,370],
    [1080,415],[1128,505],[1078,592],
    [930,632],[770,622],[610,636],[450,626],[300,640],
    [168,678],[112,752],[158,802],
    [310,838],[470,828],[630,842],[790,832],[950,846],[1105,838]
  ];

  var PIECES = [
    {emoji:"🐢", color:"#3E7D53"}, {emoji:"🦊", color:"#D23A2E"},
    {emoji:"🐸", color:"#2E4E96"}, {emoji:"🐝", color:"#B98722"},
    {emoji:"🐙", color:"#7A4A86"}, {emoji:"🐧", color:"#2B7A87"},
    {emoji:"🐌", color:"#8A5A2B"}, {emoji:"🦄", color:"#C05E9E"}
  ];

  function d6() { return 1 + Math.floor(Math.random() * 6); }

  /* Move, then keep applying whatever the space you land on says.
     Returns the whole journey so every screen can animate the same hops. */
  function resolveTurn(from, dice) {
    var pos = Math.min(FINISH, from + dice[0] + dice[1]);
    var steps = [pos], notes = [], again = false, seen = {}, hop;

    for (hop = 0; hop < 4; hop++) {
      if (pos >= FINISH) break;
      var sp = SPECIALS[pos];
      if (!sp || seen[pos]) break;
      seen[pos] = true;

      if (sp.kind === "again" || sp.kind === "castle") { again = true; notes.push(sp.desc); break; }
      if (sp.kind === "cuddle") { notes.push("Cuddle everyone!"); break; }

      var np = pos;
      if (sp.kind === "plus") np = pos + sp.n;
      else if (sp.kind === "back") np = Math.max(0, pos - sp.n);
      else if (sp.kind === "goto") np = sp.n;
      else if (sp.kind === "fork") {
        var r = d6(), on = (r <= 2 ? 1 : (r <= 4 ? 3 : 5));
        np = pos + on;
        notes.push("Crossroads die: " + r + " — on " + on);
      }
      if (sp.kind !== "fork") notes.push(sp.desc);

      np = Math.max(0, Math.min(FINISH, np));
      steps.push(np);
      pos = np;
    }
    if (pos >= FINISH) again = false;
    return {steps: steps, notes: notes, again: again, end: pos};
  }

  return {
    FINISH: FINISH, COUNT: FINISH + 1,
    SPECIALS: SPECIALS, WAY: WAY, PIECES: PIECES,
    d6: d6, resolveTurn: resolveTurn
  };
});
