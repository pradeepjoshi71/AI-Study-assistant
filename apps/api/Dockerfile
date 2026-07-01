# Multi-stage production Dockerfile for NestJS API
# Run build context from root folder of monorepo:
# docker build -t study-assistant-api -f apps/api/Dockerfile .

# --- Stage 1: Build Application ---
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

RUN apk add --no-cache libc6-compat

# Copy workspace configs and packages
COPY package*.json ./
COPY packages/shared-config ./packages/shared-config
COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api

# Install dependencies (including devDependencies)
RUN npm ci

# Generate Prisma Client
RUN cd apps/api && npx prisma generate

# Build shared types and NestJS application
RUN npm run build -w @study-assistant/shared-types
RUN npm run build -w @study-assistant/api

# --- Stage 2: Install Production Dependencies Only ---
FROM node:20-alpine AS deps

WORKDIR /usr/src/app

RUN apk add --no-cache libc6-compat

COPY package*.json ./
COPY packages/shared-config ./packages/shared-config
COPY packages/shared-types ./packages/shared-types
COPY apps/api/package*.json ./apps/api/

# Install only production dependencies
RUN npm ci --omit=dev

# Regenerate Prisma Client in production node_modules
RUN cd apps/api && npx prisma generate

# --- Stage 3: Runner ---
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

# Run as non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs

# Copy production node_modules
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=deps /usr/src/app/packages/shared-types/node_modules ./packages/shared-types/node_modules

# Copy dist built artifacts
COPY --from=builder /usr/src/app/apps/api/dist ./apps/api/dist
COPY --from=builder /usr/src/app/apps/api/package*.json ./apps/api/
COPY --from=builder /usr/src/app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /usr/src/app/packages/shared-types/package*.json ./packages/shared-types/

# Set ownership
RUN chown -R nestjs:nodejs /usr/src/app
USER nestjs

EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]

