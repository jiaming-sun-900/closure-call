#!/usr/bin/env bash
# Runs on the Linode (Ubuntu 24.04) as root. Usage: setup.sh <hostname>
set -euo pipefail
HOST="$1"
apt-get update -qq && apt-get install -y -qq caddy curl >/dev/null
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
cd /opt/closurecall/backend
uv venv -q --python 3.13 .venv && uv pip install -q --python .venv/bin/python -r requirements.txt
cat > /etc/systemd/system/closurecall.service <<UNIT
[Unit]
Description=Closure Call
After=network-online.target
[Service]
WorkingDirectory=/opt/closurecall/backend
Environment=SERVE_FRONTEND=1 ALLOW_KEY_UI=0
ExecStart=/opt/closurecall/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
  reverse_proxy 127.0.0.1:8000 {
    flush_interval -1
  }
}
CADDY
systemctl daemon-reload && systemctl enable -q --now closurecall && systemctl restart closurecall caddy
