# Multi-stage production Dockerfile for NestJS API
# Run build context from root folder of monorepo:
# docker build -t study-assistant-api -f apps/api/Dockerfile .

# --- Stage 1: Dependency Installation & Build ---
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install standard build dependencies if any native node modules exist
RUN apk add --no-cache libc6-compat

# Copy package lockfiles and workspace configs
COPY package*.json ./
COPY packages/shared-config ./packages/shared-config
COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api

# Install dependencies (including devDependencies)
RUN npm ci

# Generate Prisma Client (critical before compiling Typescript code)
RUN cd apps/api && npx prisma generate

# Build shared types and NestJS application
RUN npm run build -w @study-assistant/shared-types
RUN npm run build -w @study-assistant/api

# --- Stage 2: Production Execution Image ---
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Install PM2 globally
RUN npm install -g pm2

# Set production environment variables
ENV NODE_ENV=production

# Run as non-root user for security (principle of least privilege)
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs

# Copy package configurations and node_modules from builder
COPY package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/packages/shared-types ./packages/shared-types
COPY --from=builder /usr/src/app/apps/api ./apps/api

# Change ownership to non-root user
RUN chown -R nestjs:nodejs /usr/src/app
USER nestjs

# OCI image labels for audit trail
LABEL org.opencontainers.image.source="https://github.com/YOUR_ORG/AI-Study-assistant" \
      org.opencontainers.image.title="ai-study-assistant-api" \
      org.opencontainers.image.description="NestJS API service"

EXPOSE 3001

# ECS health check — ALB uses its own but this is used by docker health
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/v1/health || exit 1

CMD ["pm2-runtime", "start", "apps/api/ecosystem.config.js"]
