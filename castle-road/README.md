# Castle Road

A digital version of a hand-drawn board game: Start, 35 spaces, Finish, two castles,
and a set of special spaces copied from the paper original.

`index.html` is a single self-contained page. Published as a Claude Artifact, it uses
two runtime capabilities:

- `db` — one shared document (`game/state`) holds players, positions, whose turn it is
  and the log, so everyone with the link sees the same board live.
- `room` — presence, so you can see who currently has the page open.

Opened anywhere else (no `window.claude`), it falls back to pass-and-play on one device
with state kept in `localStorage`.

## Rules as implemented

Roll two dice, move that many spaces, then do what the space says. First piece to reach
Finish wins; no exact roll needed.

| Space | Effect |
| ----- | ------ |
| 4, 13 | Roll again |
| 7, 20 | Castle — roll again |
| 11 | Go on 3 |
| 16 | Shortcut to 20 |
| 18 | Cuddle everyone |
| 24 | Go back 3 |
| 28 | Crossroads: roll one die — 1-2 go on 1, 3-4 go on 3, 5-6 go on 5 |
| 32 | Go on 2 |

Special spaces live in the `SPECIALS` object near the top of the script; the board
redraws itself from that object, so changing a rule is a one-line edit.
