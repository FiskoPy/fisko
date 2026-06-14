# Fisko API — deterministic build (bypasses Railpack/Nixpacks monorepo quirks).
# Build context = apps/api (Railway Root Directory = apps/api).
FROM node:20-slim

# OpenSSL for Prisma engines.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all deps (incl. dev) so tsc is available for the build.
# `prisma generate` runs via postinstall (prisma is a runtime dep).
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Compile TypeScript -> dist/
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# Runtime
ENV NODE_ENV=production
EXPOSE 3000
# Railway injects PORT; the app reads process.env.PORT.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
