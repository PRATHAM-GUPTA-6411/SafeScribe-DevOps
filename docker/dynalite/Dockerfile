# syntax=docker/dockerfile:1
# DEVELOPMENT ONLY: local DynamoDB emulator for docker compose. Not deployed to AWS.
FROM node:22.23.4-alpine3.24
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
USER 1000:1000
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 CMD ["node", "-e", "require('fs').accessSync('/tmp/ready')"]
CMD ["node", "server.js"]
