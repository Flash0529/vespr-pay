# A VESPR runner in a container: runs workspace commands for the room it is allowed to serve.
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js lib.js job.js local.js sandbox.js sandbox_exec.py sandbox_guard.py ./
# Native mode needs a cgroups-v2/systemd user manager and bubblewrap on the host.
# This basic container does not provide those: native jobs fail closed. Do not
# add privileged mode or a Docker socket to bypass the requirement. Use a
# dedicated Linux runner service, or explicitly opt into trusted-local execution
# only for owner-trusted commands in an externally isolated container.
USER node
ENTRYPOINT ["node", "index.js"]
