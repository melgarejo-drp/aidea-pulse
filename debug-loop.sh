#!/bin/bash
# AIdea Pulse — Debug + Autonomous Improvement Loop (every 60s)

APP_URL="https://aidea-pulse.vercel.app"
API_URL="$APP_URL/api/brief"
LOG="/tmp/aidea-pulse-debug.log"
IMPL_LOG="/tmp/aidea-pulse-impl.log"
TOKEN_V="${VERCEL_TOKEN}"
ITERATION=0
LAST_IMPL=0  # epoch of last implementation attempt

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

deploy() {
  log "→ Deploying to Vercel..."
  DEPLOY=$(curl -s -X POST -H "Authorization: Bearer $TOKEN_V" -H "Content-Type: application/json" \
    https://api.vercel.com/v13/deployments \
    -d '{"name":"aidea-pulse","gitSource":{"type":"github","repoId":1181956459,"ref":"master","org":"melgarejo-drp","repo":"aidea-pulse"},"projectSettings":{"framework":null}}')
  DEPLOY_ID=$(echo $DEPLOY | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  if [ -z "$DEPLOY_ID" ]; then log "Deploy failed — no ID"; return 1; fi
  log "Deploy $DEPLOY_ID — waiting..."
  sleep 25
  STATUS=$(curl -s -H "Authorization: Bearer $TOKEN_V" "https://api.vercel.com/v13/deployments/$DEPLOY_ID" | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('readyState',''))" 2>/dev/null)
  log "Deploy state: $STATUS"
  if [ "$STATUS" = "READY" ]; then
    curl -s -X POST -H "Authorization: Bearer $TOKEN_V" -H "Content-Type: application/json" \
      "https://api.vercel.com/v2/deployments/$DEPLOY_ID/aliases" \
      -d '{"alias":"aidea-pulse.vercel.app"}' > /dev/null
    return 0
  fi
  return 1
}

push_fix() {
  MSG="$1"
  cd ~/projects/aidea-pulse
  export GIT_AUTHOR_NAME="Limoncito"
  export GIT_AUTHOR_EMAIL="melgarejorodriguez19@gmail.com"
  export GIT_COMMITTER_NAME="Limoncito"
  export GIT_COMMITTER_EMAIL="melgarejorodriguez19@gmail.com"
  git add -A && git commit -m "$MSG" && \
    git push "https://melgarejo-drp:${GITHUB_TOKEN}@github.com/melgarejo-drp/aidea-pulse.git" master && deploy
}

check_api() {
  RESPONSE=$(curl -s -m 15 "$API_URL" 2>/dev/null)
  if [ -z "$RESPONSE" ]; then echo "EMPTY"; return; fi
  python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    if 'error' in d: print('ERROR:' + str(d['error'])[:80])
    elif len(d.get('tendencias',[])) < 3: print('INCOMPLETE:tendencias=' + str(len(d.get('tendencias',[]))))
    elif len(d.get('ideas_instagram',[])) < 3: print('INCOMPLETE:instagram=' + str(len(d.get('ideas_instagram',[]))))
    elif len(d.get('ideas_linkedin',[])) < 2: print('INCOMPLETE:linkedin=' + str(len(d.get('ideas_linkedin',[]))))
    else: print('OK')
except Exception as e: print('PARSE_ERROR:' + str(e)[:60])
" <<< "$RESPONSE"
}

try_implement() {
  NOW=$(date +%s)
  ELAPSED=$(( NOW - LAST_IMPL ))
  # Wait at least 3 min between implementation attempts
  if [ $ELAPSED -lt 180 ]; then return; fi
  # Don't implement if lock exists (prev impl running)
  if [ -f /tmp/aidea-pulse-implementing.lock ]; then
    log "  impl: locked (in progress)"
    return
  fi

  log "→ Checking roadmap for pending improvements..."
  IMPL_RESULT=$(NOTION_KEY=$(cat ~/.config/notion/api_key) \
    ANTHROPIC_KEY=$(grep ANTHROPIC_API_KEY ~/projects/second-brain-bot/.env | cut -d= -f2) \
    VERCEL_TOKEN="$TOKEN_V" \
    GITHUB_TOKEN="${GITHUB_TOKEN}" \
    python3 ~/projects/aidea-pulse/implement.py 2>&1 | tee -a "$IMPL_LOG")

  LAST_IMPL=$(date +%s)

  if echo "$IMPL_RESULT" | grep -q "NO_PENDING"; then
    log "  roadmap: all implemented ✅"
  elif echo "$IMPL_RESULT" | grep -q "SUCCESS:"; then
    SUMMARY=$(echo "$IMPL_RESULT" | grep "SUCCESS:" | sed 's/SUCCESS: //')
    log "  ✅ IMPLEMENTED: $SUMMARY"
  elif echo "$IMPL_RESULT" | grep -q "ERROR:"; then
    ERR=$(echo "$IMPL_RESULT" | grep "ERROR:" | head -1)
    log "  ❌ IMPL ERROR: $ERR"
  elif echo "$IMPL_RESULT" | grep -q "LOCKED"; then
    log "  impl: locked"
  fi
}

log "=== AIdea Pulse Loop started (60s interval) ==="

while true; do
  ITERATION=$((ITERATION + 1))
  log "--- Iteration $ITERATION ---"

  RESULT=$(check_api)
  log "API check: $RESULT"

  if [ "$RESULT" = "OK" ]; then
    log "✅ Health OK"
    # Health is fine — try to implement next improvement
    try_implement

  elif [[ "$RESULT" == ERROR:* ]]; then
    ERROR_MSG="${RESULT#ERROR:}"
    log "🔴 API error: $ERROR_MSG"
    if echo "$ERROR_MSG" | grep -qi "json\|parse"; then
      cd ~/projects/aidea-pulse
      sed -i 's/sin texto extra, sin markdown, sin comentarios, sin explicaciones/Responde SOLO con JSON puro. Cero texto adicional./' api/brief.js
      push_fix "fix: stricter JSON-only prompt (auto)"
    else
      deploy
    fi

  elif [[ "$RESULT" == INCOMPLETE:* ]]; then
    log "🟡 Incomplete — redeploying..."
    deploy

  elif [ "$RESULT" = "EMPTY" ]; then
    log "🔴 Empty response — redeploying..."
    deploy
  fi

  log "Sleeping 60s..."
  sleep 60
done
