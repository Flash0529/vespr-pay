FROM node:20-slim
# git for the workspace's git hosting (clone, fetch, push)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.js ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV MURMIO_HOST=0.0.0.0 MURMIO_PORT=8241 MURMIO_DATA=/data MURMIO_TOKENS_FILE=/run/secrets/murmio-tokens
EXPOSE 8241
CMD ["node", "index.js"]
