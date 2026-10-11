# Deploy (Akamai Cloud / Linode)

Live: https://172-236-110-231.ip.linodeusercontent.com (Nanode 1 GB, Chicago, Ubuntu 24.04)

- Caddy terminates HTTPS (automatic Let's Encrypt) and proxies to uvicorn on 127.0.0.1:8000.
- FastAPI serves the API and the built frontend on one origin (`SERVE_FRONTEND=1`).
- `ALLOW_KEY_UI=0`: the Settings page cannot change the key or clear records on the public server.

Redeploy after changes:

```
cd frontend && npm run build && cd ..
rsync -az -e "ssh -i ~/.ssh/closurecall" --exclude .venv --exclude __pycache__ --exclude 'records*.jsonl' --exclude assessments --exclude '*_cache.json' backend root@172.236.110.231:/opt/closurecall/
rsync -az --delete -e "ssh -i ~/.ssh/closurecall" frontend/dist root@172.236.110.231:/opt/closurecall/frontend/
ssh -i ~/.ssh/closurecall root@172.236.110.231 systemctl restart closurecall
```
