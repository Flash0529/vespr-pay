#!/bin/bash
# Runs ON the VM: wipes the two judge workspaces back to the sample project (chat, files, replay log). The agent and the tokens stay.
set -eu
cd "$(dirname "$0")"
sudo docker compose down
sudo docker volume rm murmio-judge_ws-judge1 murmio-judge_ws-judge2 murmio-judge_collab-data 2>/dev/null || true
sudo docker compose up -d
echo "reset done"
