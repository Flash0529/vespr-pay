#!/bin/bash
# Runs ON the VM (Ubuntu): installs Docker and the compose plugin, adds a little swap for image builds. Safe to run twice.
set -eu
if ! sudo docker compose version >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io curl ca-certificates
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-v2 || true
fi
if ! sudo docker compose version >/dev/null 2>&1; then   # fallback: Docker's own apt repository
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true
if [ "$(awk '/SwapTotal/ {print $2}' /proc/meminfo)" -lt 1000000 ]; then   # builds of the SDE image are memory hungry
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
sudo docker compose version
echo "bootstrap done"
