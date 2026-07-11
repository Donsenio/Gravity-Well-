# Gravity Well: Reclaimed

A single-player space arcade/strategy game inspired by Gravity Well (1995, Software Engineering, Inc.).

Explore an uncharted sector, claim planets, dispatch freighters to build colonies, and hold off the Ashkari Reach — all in real time with gravity physics.

## Play

Pilot your ship, scout hidden planets, and be the first to claim 4 of 5.

| Key | Action |
|---|---|
| W / ↑ | Thrust |
| A / D or ← / → | Rotate |
| Space | Shoot |

Click the game to give it keyboard focus. Use the Restart button any time.

## Run locally

No build step, no dependencies. Just open `index.html` in a browser, or:

```
npx serve .
```

## Deploy to Netlify

1. Push this folder to a GitHub repo.
2. In Netlify: **Add new site → Import from Git → pick the repo.**
3. Build command: *(leave empty)*. Publish directory: `/` (root).
4. Deploy. Done — it's a static site.

## Project structure

```
index.html   — page shell, HUD, controls bar
style.css    — all styling
game.js      — the entire game (config, state, update, draw, loop)
```

All gameplay tuning lives in the `CONFIG` object at the top of `game.js`.
Want the ship faster? Change `CONFIG.ship.thrust`. Enemies harder? Raise
`CONFIG.enemies.maxSpeed` or `waveSize`. No hunting through the code.

## Roadmap

- [x] **Phase 1 — Prototype:** ship movement, gravity, shooting, one planet
- [x] **Phase 2 — Sector map:** fog of war, 5 planets, freighters, Ashkari AI, minimap, credits
- [ ] **Phase 3 — Full war:** Pale Syndicate + Vorath Dominion factions, upgrade shop (spend credits), base defenses, contested planets
- [ ] **Phase 4 — Polish:** sound effects, sector progression, difficulty settings, faction personalities

## Credits

Inspired by *Gravity Well* © 1995 Software Engineering, Inc.
This is an original fan-inspired game — no original assets or code are used.
