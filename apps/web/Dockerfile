# Multi-stage production Dockerfile for NextJS Web
# Run build context from root folder of monorepo:
# docker build -t study-assistant-web -f apps/web/Dockerfile .

# --- Stage 1: Dependency Installation & Build ---
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install dependencies needed for compiling native packages
RUN apk add --no-cache libc6-compat

# Copy workspace configs and packages
COPY package*.json ./
COPY packages/shared-config ./packages/shared-config
COPY packages/shared-types ./packages/shared-types
COPY apps/web ./apps/web

# Install dependencies
RUN npm ci

# Build shared packages and the frontend web app
RUN npm run build -w @study-assistant/shared-types
RUN npm run build -w @study-assistant/web

# --- Stage 2: Production Execution Image ---
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy NextJS standalone server files and client-side static resources
COPY --from=builder /usr/src/app/apps/web/public ./apps/web/public
COPY --from=builder /usr/src/app/apps/web/.next/standalone ./
COPY --from=builder /usr/src/app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
