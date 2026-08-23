#!/usr/bin/env bash
# Déploie Blackjack Royale sur Railway (exécuté par GitHub Actions).
# Nécessite le secret RAILWAY_API_TOKEN (railway.com → Account Settings → Tokens).
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-blackjack-royale}"
SERVICE_NAME="${SERVICE_NAME:-blackjack}"

if [ -z "${RAILWAY_API_TOKEN:-}" ]; then
  echo "Secret RAILWAY_API_TOKEN manquant : ajoutez-le dans Settings → Secrets and variables → Actions." >&2
  exit 1
fi

echo "::group::Version du CLI"
railway --version
echo "::endgroup::"

# --- Projet : on réutilise s'il existe déjà, sinon on le crée -----------------
set +e
PROJECT_ID=$(railway list --json 2>/dev/null | jq -r \
  --arg n "$PROJECT_NAME" '.. | objects | select(.name? == $n) | .id' | head -n 1)
set -e

if [ -n "${PROJECT_ID:-}" ]; then
  echo "Projet existant trouvé : $PROJECT_ID"
  railway link --project "$PROJECT_ID" --environment production
else
  echo "Création du projet $PROJECT_NAME…"
  railway init --name "$PROJECT_NAME"
fi

# --- Service ------------------------------------------------------------------
set +e
railway status --json > status.json 2>/dev/null
HAS_SERVICE=$(jq -r --arg s "$SERVICE_NAME" \
  '.. | objects | select(.name? == $s) | .name' status.json 2>/dev/null | head -n 1)
set -e
if [ -z "${HAS_SERVICE:-}" ]; then
  echo "Création du service $SERVICE_NAME…"
  railway add --service "$SERVICE_NAME"
fi

# --- Premier déploiement du code ----------------------------------------------
echo "Envoi du code…"
railway up --service "$SERVICE_NAME" --detach

# --- Domaine public + PUBLIC_URL ----------------------------------------------
echo "Génération du domaine public…"
set +e
DOMAIN_JSON=$(railway domain --service "$SERVICE_NAME" --json 2>/dev/null)
set -e
DOMAIN=$(echo "${DOMAIN_JSON:-}" | jq -r '.. | objects | .domain? // empty' | head -n 1)
if [ -z "${DOMAIN:-}" ]; then
  # Certaines versions du CLI impriment simplement l'URL en texte.
  DOMAIN=$(railway domain --service "$SERVICE_NAME" 2>/dev/null | grep -oE '[a-z0-9.-]+\.up\.railway\.app' | head -n 1)
fi
if [ -z "${DOMAIN:-}" ]; then
  echo "Impossible de déterminer le domaine — vérifiez le dashboard Railway." >&2
  exit 1
fi

PUBLIC_URL="https://$DOMAIN"
echo "Domaine : $PUBLIC_URL"
railway variables --service "$SERVICE_NAME" --set "PUBLIC_URL=$PUBLIC_URL" --skip-deploys

# Redéploiement pour prendre la variable en compte.
railway up --service "$SERVICE_NAME" --detach

echo "=============================================================="
echo "  🃏 Jeu en ligne : $PUBLIC_URL"
echo "  🖥️ Vue table    : $PUBLIC_URL/host"
echo "=============================================================="
