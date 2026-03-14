#!/bin/bash
# AIdea Pulse — Debug loop autónomo (cada 5 minutos)

APP_URL="https://aidea-pulse.vercel.app"
API_URL="$APP_URL/api/brief"
REPO="~/projects/aidea-pulse"
LOG="/tmp/aidea-pulse-debug.log"
TOKEN_V="${VERCEL_TOKEN}"
TOKEN_GH="${GITHUB_TOKEN}"
ITERATION=0

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

deploy() {
  log "→ Deploying to Vercel..."
  DEPLOY=$(curl -s -X POST -H "Authorization: Bearer $TOKEN_V" -H "Content-Type: application/json" \
    https://api.vercel.com/v13/deployments \
    -d '{"name":"aidea-pulse","gitSource":{"type":"github","repoId":1181956459,"ref":"master","org":"melgarejo-drp","repo":"aidea-pulse"},"projectSettings":{"framework":null}}')
  DEPLOY_ID=$(echo $DEPLOY | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  if [ -z "$DEPLOY_ID" ]; then log "Deploy failed"; return 1; fi
  log "Deploy started: $DEPLOY_ID — waiting..."
  sleep 25
  STATUS=$(curl -s -H "Authorization: Bearer $TOKEN_V" "https://api.vercel.com/v13/deployments/$DEPLOY_ID" | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('readyState',''))" 2>/dev/null)
  log "Deploy status: $STATUS"
  [ "$STATUS" = "READY" ]
}

push_fix() {
  cd ~/projects/aidea-pulse
  git add -A && git commit -m "fix: auto-debug iteration $ITERATION" && \
    git push origin master && deploy
}

check_api() {
  RESPONSE=$(curl -s -m 15 "$API_URL" 2>/dev/null)
  if [ -z "$RESPONSE" ]; then echo "EMPTY"; return; fi
  python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    if 'error' in d:
        print('ERROR:' + str(d['error'])[:80])
    elif len(d.get('tendencias',[])) < 3:
        print('INCOMPLETE:tendencias=' + str(len(d.get('tendencias',[]))))
    elif len(d.get('ideas_instagram',[])) < 3:
        print('INCOMPLETE:instagram=' + str(len(d.get('ideas_instagram',[]))))
    elif len(d.get('ideas_linkedin',[])) < 2:
        print('INCOMPLETE:linkedin=' + str(len(d.get('ideas_linkedin',[]))))
    else:
        print('OK')
except Exception as e:
    print('PARSE_ERROR:' + str(e)[:60])
" <<< "$RESPONSE"
}

log "=== AIdea Pulse Debug Loop started ==="

while true; do
  ITERATION=$((ITERATION + 1))
  log "--- Iteration $ITERATION ---"

  RESULT=$(check_api)
  log "API check: $RESULT"

  if [ "$RESULT" = "OK" ]; then
    log "✅ All checks passed."

  elif [[ "$RESULT" == ERROR:* ]]; then
    ERROR_MSG="${RESULT#ERROR:}"
    log "🔴 API error: $ERROR_MSG"

    # Fix: si el error es de JSON parsing, revisar el prompt
    if echo "$ERROR_MSG" | grep -qi "json\|parse\|unexpected"; then
      log "→ JSON parse error detected. Adding stricter JSON instruction..."
      cd ~/projects/aidea-pulse
      # Agregar instrucción más estricta al prompt
      sed -i 's/sin texto extra, sin markdown/sin texto extra, sin markdown, sin comentarios, sin explicaciones/' api/brief.js
      push_fix
    else
      log "→ Unknown error, redeploying..."
      deploy
    fi

  elif [[ "$RESULT" == INCOMPLETE:* ]]; then
    WHAT="${RESULT#INCOMPLETE:}"
    log "🟡 Incomplete data: $WHAT — redeploying..."
    deploy

  elif [ "$RESULT" = "EMPTY" ]; then
    log "🔴 Empty response — checking deployment status..."
    LATEST=$(curl -s -H "Authorization: Bearer $TOKEN_V" \
      "https://api.vercel.com/v6/deployments?projectId=prj_rFihI4ndTrGm3v7Yr9CLkw3F9vVw&limit=1" | \
      python3 -c "import sys,json; d=json.load(sys.stdin); deps=d.get('deployments',[]); print(deps[0].get('readyState','') if deps else 'none')" 2>/dev/null)
    log "Latest deployment: $LATEST"
    if [ "$LATEST" != "READY" ]; then
      deploy
    else
      log "→ Deployment OK but API empty, force redeploy..."
      deploy
    fi
  fi

  log "Sleeping 5 min..."
  sleep 300
done
