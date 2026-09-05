# Castle Road

A digital version of a hand-drawn board game: Start, 35 spaces, Finish, two red
castles, and the special spaces from the paper original.

Two people (or eight) open the same link on any device and play together in real
time. **No accounts, no app, nothing to install for the players** — whoever you
send the link to just opens it and types a name.

```
castle-road/
├── server.js            the whole server: ~300 lines, no dependencies
├── public/
│   ├── index.html       the page
│   ├── app.js           board drawing, animation, talking to the server
│   └── game-rules.js    the board and its rules — shared by page and server
├── Dockerfile           if you'd rather deploy a container
├── render.yaml          one-click config for Render
└── artifact/index.html  the earlier single-file version (Claude Artifact)
```

## Run it

Node 18 or newer, nothing to install:

```bash
cd castle-road
node server.js          # http://localhost:3000
```

Open the page, press **Start a new game**, then **Invite** to copy the link.
Everyone on your home wi-fi can already join at `http://<your-computer>:3000/#CODE`.

## Put it on the internet

Any host that runs Node works. The service needs no database and no build step —
`node server.js`, listening on `$PORT`.

**Render** (free tier, from this repo):

1. render.com → **New → Web Service** → connect this repository.
2. Root directory `castle-road`, build command empty, start command `node server.js`.
3. Deploy. You get a `https://something.onrender.com` URL — that's the game.

(Or move `render.yaml` to the repository root and use **New → Blueprint** instead.)
Free instances sleep when idle, so the first load after a quiet spell takes a few
seconds to wake up. Games survive that; see persistence below.

**Fly.io**: `fly launch` in `castle-road/` picks up the Dockerfile; add a volume
mounted at `/app/data` if you want games to survive a restart.

**Anything else** — Railway, Glitch, a Raspberry Pi, a VPS: copy the folder, run
`node server.js`, point a port at it.

## How it works

- Each game is a four-letter room code, carried in the URL fragment (`/#ABCD`),
  so sharing the link is the whole invitation.
- The server holds the game and pushes every change to open pages over
  server-sent events — a plain HTTP stream that reconnects on its own, so a
  dropped phone signal or a sleeping laptop catches up without a refresh.
- Turns are enforced server-side: your browser can only roll when it's your
  turn, and the dice are rolled by the server.
- One browser can hold several seats ("Add player"), so two people on the sofa
  can share a screen while everyone else is on their own.
- Rooms are kept in memory and written to `data/rooms.json` every few seconds,
  so a restart or a free-tier sleep doesn't lose a game. Set `DATA_FILE` to move
  that file. Rooms nobody has opened for 24 hours are cleared out.

## The rules, as implemented

Roll two dice, move that many spaces, then do what the space says. First piece
to reach Finish wins — no exact roll needed.

| Space | What happens |
| ----- | ------------ |
| 4, 13 | Roll again |
| 7, 20 | Castle — roll again |
| 11 | Go on 3 |
| 16 | Shortcut to 20 |
| 18 | Cuddle everyone |
| 24 | Go back 3 |
| 28 | Crossroads: roll one die — 1-2 go on 1, 3-4 go on 3, 5-6 go on 5 |
| 32 | Go on 2 |

All of it lives in the `SPECIALS` object in `public/game-rules.js`. The board
redraws itself from that object and the server plays by it, so changing a rule —
or adding a space — is a one-line edit in one file.
