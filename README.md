# Dribble Dojo · ドリブル道場

The most realistic basketball **dribbling** simulator we can make, drawn like a 90s
anime (think *Slam Dunk*). Solo practice gym, combo scoring, jump shots, leaderboard.

> Status: scaffold — the gym, court, player, three cameras and the HUD shell are in.
> Dribbling, shooting and scoring land in the next tickets.

## Run it

```bash
docker compose up -d --wait   # Postgres on localhost:5433
cp .env.example .env
npm install
npm run db:migrate
npm run dev                   # http://localhost:3000
```

`/api/health` reports `{"ok":true,"db":"ok"}` when Postgres is reachable (503 otherwise).
The game itself never needs the database.

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| J / L | Dribble in left / right hand |
| I | High path (crossover `L,I,J` / `J,I,L`) · alone: high dribble |
| K | Between the legs (`L,K,J` / `J,K,L`) |
| , | Behind the back (`J,,,L` / `L,,,J`) |
| Space | Jumper — hold to rise, release at the top |
| V | Cycle camera: **B** behind-shoulder → **A** isometric → **C** broadcast |

## Stack

Next.js 16 (App Router, TypeScript) · three.js · Drizzle ORM + Postgres · Playwright for
verification. Deploys on Vercel; production reads `DATABASE_URL` from the environment
(hosted Postgres such as Neon).

See [AGENTS.md](AGENTS.md) for layout and conventions.
