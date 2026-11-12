# Judge demo on a Nebius VM

Status: run on a Nebius VM on 2026-10-28 and tested over the internet with `agents/tools/smoke-remote.mjs` (live connection, the agent using the Code Map, starting a project after approval, and serving its preview).
What it is: two SDE logins (judge1, judge2) and one AI agent in one shared room, behind HTTPS, with caps on memory, processes, CPU and AI tokens (default 600,000 tokens per 24 h).
The rules require judges to reach a working demo for free until Dec 15, so this instance has no paywall.

## Set up (once)
1. Create a Nebius AI Cloud account and set up billing, and get a Token Factory API key (put `NEBIUS_API_KEY=...` in a file such as `nebius.env`; never commit it).
2. Create a **CPU** VM (platform `cpu-d3`, preset **2vcpu-8gb**, an **Ubuntu** image, a **50 GiB** boot disk, a **static public IP**, your SSH public key). New accounts may start with a vCPU quota of 0 in some regions: pick a region with a quota or request one. The default network security group allows inbound 80 and 443.
3. Note the VM's public IP address.

## Deploy
```
cd deploy/judge
NEBIUS_ENV=./nebius.env ./make-env.sh 203-0-113-5.sslip.io    # the VM's IP with dashes + .sslip.io: free HTTPS names with no DNS to set up
SSH_KEY=~/.ssh/your_key ./deploy-to-vm.sh ubuntu@203.0.113.5
```
Or use your own name: add A records for `collab.NAME`, `judge1.NAME`, `judge2.NAME` pointing at the VM and pass NAME to `make-env.sh`.
`make-env.sh` writes the two SDE login links (they contain tokens) to `judge-links.txt` (ignored by git); share them only with the people who should have a login.

## Operating it
- Reset the workspaces: `ssh murmio@IP 'bash ~/murmio/deploy/judge/reset.sh'`.
- Watch it: `sudo docker compose logs -f agent-coder` (the agent says when the token budget is used up).
- Save money: a stopped VM is not billed for compute (its disk still is). Judging is Dec 1-15; keep it running for as long as people need to test it.
- Take it down: `sudo docker compose down` (or delete the VM and its disk in the console).

## Cost (compute only, from the Nebius pricing page read 2026-10-28: $0.015 per vCPU-hour, $0.0045 per GiB-hour of RAM)
2vcpu-8gb is about $0.066/h, so about $76 from Oct 29 to Dec 15; 4vcpu-16gb is about $0.132/h, about $152. Disk and traffic are extra. These credits are separate from the Token Factory credits.

## Limits, honestly
- Anyone with a judge link can run commands in a container on this VM (that is the product), so the VM holds nothing else: no secrets besides this demo's Nebius key, which is capped by the token budget. The Token Factory key lives only in this VM's `.env`.
- Previews and the SDE are served by the same VM; the preview link is a capability URL.
- Not yet tried on a real VM: image builds on x86, certificate issuance, WebSockets through Caddy on the public internet.

- Uploads (decks, sheets, PDFs, pictures, audio, video, 3D) are on: `/api/upload/<room>` with a judge's token. Because this server is public, the compose file caps them at 10 MB a file and 100 MB a workspace (`MURMIO_UPLOAD_MAX_MB`, `MURMIO_UPLOAD_ROOM_MB`); `reset.sh` deletes them with the rest of the demo data. Redeployed with uploads, skills and CORS on 2026-10-28; verified with `agents/tools/smoke-remote.mjs` (6 of 6).
