#!/usr/bin/env bash
# Read-only health check for a Dribble Dojo checkout. Changes nothing.
#   bash scripts/verify/doctor.sh [http://localhost:3000]
set -u
URL="${1:-http://localhost:3000}"
pass() { printf '  ok    %s\n' "$1"; }
warn() { printf '  WARN  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; status=1; }
status=0

echo "Dribble Dojo doctor"
node -v >/dev/null 2>&1 && pass "node $(node -v)" || fail "node not found"
[ -d node_modules ] && pass "node_modules present" || warn "node_modules missing → npm install"
[ -f .env ] && pass ".env present" || warn ".env missing → cp .env.example .env"

if docker info >/dev/null 2>&1; then
  pass "docker daemon up"
  state=$(docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null)
  [ -n "$state" ] && pass "compose: $state" || warn "compose db not running → docker compose up -d --wait"
  if docker compose exec -T db psql -U dojo -d dribble_dojo -tAc \
      "select count(*) from drizzle.__drizzle_migrations" >/tmp/dojo-mig.$$ 2>/dev/null; then
    pass "migrations applied: $(tr -d '[:space:]' </tmp/dojo-mig.$$)"
  else
    warn "migrations table not readable → npm run db:migrate"
  fi
  rm -f /tmp/dojo-mig.$$
else
  warn "docker daemon not reachable"
fi

if code=$(curl -s -o /tmp/dojo-health.$$ -w '%{http_code}' "$URL/api/health" 2>/dev/null) && [ "$code" != "000" ]; then
  body=$(cat /tmp/dojo-health.$$)
  [ "$code" = "200" ] && pass "health $code $body" || fail "health $code $body"
  page=$(curl -s -o /dev/null -w '%{http_code}' "$URL/")
  [ "$page" = "200" ] && pass "GET / $page" || fail "GET / $page"
else
  warn "no server at $URL → npm run dev"
fi
rm -f /tmp/dojo-health.$$
exit $status
