# Deploy (Akamai Cloud / Linode), hackathon only

Retired 2026-10-13: the app now runs on Render (see `render.yaml` at the repo root). These scripts are kept for reference.

Was: Nanode 1 GB, Chicago, Ubuntu 24.04

- Caddy terminates HTTPS (automatic Let's Encrypt) and proxies to uvicorn on 127.0.0.1:8000.
- FastAPI serves the API and the built frontend on one origin (`SERVE_FRONTEND=1`).
- `ALLOW_KEY_UI=0`: the Settings page cannot change the key or clear records on the public server.

Redeploy after changes: `./deploy/push.sh` (git push does not deploy).
