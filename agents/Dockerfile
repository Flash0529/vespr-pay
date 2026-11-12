FROM node:20-slim
# python3 (with pip and venv) so the sandbox can run tests and scripts and install a Python project's requirements
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js ./
COPY src ./src
USER node
CMD ["node", "index.js"]
