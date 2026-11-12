# VESPR SDE: real VS Code (Code - OSS via openvscode-server) with the VESPR collaboration extension.
FROM debian:bookworm-slim
ARG OVS_VERSION=1.109.5
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client procps less nano python3 build-essential libxkbfile1 libsecret-1-0 libkrb5-3 \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; arch=$([ "$TARGETARCH" = "arm64" ] && echo arm64 || echo x64); \
    curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OVS_VERSION}/openvscode-server-v${OVS_VERSION}-linux-${arch}.tar.gz" \
      | tar -xz -C /opt; \
    mv "/opt/openvscode-server-v${OVS_VERSION}-linux-${arch}" /opt/openvscode-server
# Node.js for the people and agents working in the SDE terminal (the SDE itself runs on its own bundled Node). Pinned, checksum-checked.
ARG NODE_VERSION=24.22.1
ARG NODE_SHA256_ARM64=33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3
ARG NODE_SHA256_X64=eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c
RUN set -eux; \
    if [ "$TARGETARCH" = "arm64" ]; then arch=arm64; sum="$NODE_SHA256_ARM64"; else arch=x64; sum="$NODE_SHA256_X64"; fi; \
    f="node-v${NODE_VERSION}-linux-${arch}.tar.gz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${f}"; \
    echo "${sum}  ${f}" | sha256sum -c -; \
    tar -xzf "$f" -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md; \
    rm -f "$f"; node -v; npm -v
# Rebrand the bundled VS Code web UI as VESPR: name, colors, logo, icons, and defaults that also reach the browser (no Welcome walkthrough, no menu bar, no command center). See brand/apply.js.
COPY brand /tmp/brand
RUN set -eux; node /tmp/brand/apply.js; \
    cp /tmp/brand/code-icon.svg /opt/openvscode-server/out/media/code-icon.svg; \
    cp /tmp/brand/code-192.png /tmp/brand/code-512.png /tmp/brand/favicon.ico /opt/openvscode-server/resources/server/; \
    rm -rf /tmp/brand
RUN useradd -m -u 1100 -s /bin/bash murmio && mkdir -p /workspace && chown murmio:murmio /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
USER murmio
ENV HOME=/home/murmio
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
