# =============================================================================
# The White Protocol Relayer — Production Dockerfile
# =============================================================================
# Build context should be the repo root:
#   docker build -f relayer/Dockerfile .
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:18.20-slim AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy relayer package files and install all dependencies (including devDeps for build)
COPY ./relayer/package*.json ./
RUN npm install

# Copy relayer source and build
COPY ./relayer/ .
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production
# -----------------------------------------------------------------------------
FROM node:18.20-slim AS production

ENV NODE_ENV=production
ENV PORT=3000

# Create app directory and set non-root user
WORKDIR /app
RUN chown -R node:node /app
USER node

# Copy package files and install production dependencies only
COPY --chown=node:node ./relayer/package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy built artifacts and required runtime assets
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/src ./src

# Copy ZK circuit artifacts required at runtime
COPY --chown=node:node ./relayer/circuits ./circuits

# Create persistent state directory
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "dist/index.js"]
