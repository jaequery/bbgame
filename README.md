# Dribble Dojo · ドリブル道場

The most realistic basketball **dribbling** simulator we can make, drawn like a 90s
anime (think *Slam Dunk*). Solo practice gym, combo scoring, jump shots, leaderboard.

The title screen offers a **60-second Session** (the score at the buzzer is your run —
enter 3-letter initials and it goes on the global top-10 leaderboard) or **Free Practice**
(no clock, nothing saved; Esc returns to the title).

## Run it

```bash
docker compose up -d --wait   # Postgres on localhost:5433
cp .env.example .env
npm install
npm run db:migrate
npm run dev                   # http://localhost:3000
```

`/api/health` reports `{"ok":true,"db":"ok"}` when Postgres is reachable (503 otherwise).
The game itself never needs the database; without it the leaderboard shows "offline".

### Leaderboard API

| Route | |
|---|---|
| `GET /api/runs` | Top 10 all-time `{ ok, runs: [{ id, initials, score, bestCombo, createdAt }] }` |
| `POST /api/runs` | `{ initials: "ABC", score, bestCombo }` → 201. Initials A–Z ×3, integer score 0–2,000,000, combo 0–1,000 (else 400); 5 submissions/min per IP (429); 503 when the DB is down. |

### Deploying (Vercel)

Set `DATABASE_URL` to a hosted Postgres (e.g. Neon) in the Vercel project env and run
`DATABASE_URL=<that url> npm run db:migrate` once per new migration in `drizzle/`.
The rate limit is in-memory, so it applies per function instance.

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| J / L | Dribble in left / right hand |
| I | High path (crossover `L,I,J` / `J,I,L`) · alone: high dribble |
| K | Between the legs (`L,K,J` / `J,K,L`) |
| , | Behind the back (`J,,,L` / `L,,,J`) |
| E | Pass to your teammate (2v2 only) |
| Space | Jumper — hold to rise, release at the top |
| V | Cycle camera: **B** behind-shoulder → **A** isometric → **C** broadcast |
| Esc | Back to the title (abandons a Session without saving) |

## Stack

Next.js 16 (App Router, TypeScript) · three.js · Drizzle ORM + Postgres · Playwright for
verification. Deploys on Vercel; production reads `DATABASE_URL` from the environment
(hosted Postgres such as Neon).

See [AGENTS.md](AGENTS.md) for layout and conventions.
