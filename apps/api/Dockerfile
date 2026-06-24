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

# Set production environment variables
ENV NODE_ENV=production

# Copy package configurations and node_modules from builder
COPY package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/packages/shared-types ./packages/shared-types
COPY --from=builder /usr/src/app/apps/api ./apps/api

EXPOSE 3001

CMD ["npm", "run", "start:prod", "-w", "@study-assistant/api"]
