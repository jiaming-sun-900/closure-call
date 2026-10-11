#!/usr/bin/env bash
# Build the frontend and copy the current code to the Akamai server. Usage: deploy/push.sh
set -euo pipefail
cd "$(dirname "$0")/.."
H=root@172.236.110.231
K="ssh -i $HOME/.ssh/closurecall"
(cd frontend && npm run build >/dev/null)
rsync -az -e "$K" --exclude .venv --exclude __pycache__ --exclude .pytest_cache --exclude 'records*.jsonl' \
  --exclude assessments --exclude '*_cache.json' --exclude facility_status.json backend $H:/opt/closurecall/
rsync -az --delete -e "$K" frontend/dist $H:/opt/closurecall/frontend/
$K $H 'cd /opt/closurecall/backend && uv pip install -q --python .venv/bin/python -r requirements.txt && systemctl restart closurecall'
echo "Deployed: https://172-236-110-231.ip.linodeusercontent.com"
