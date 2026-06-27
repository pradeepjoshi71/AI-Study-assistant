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

# Non-root user matching Next.js recommended setup
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy NextJS standalone server files and client-side static resources
COPY --from=builder /usr/src/app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /usr/src/app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /usr/src/app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

# OCI image labels
LABEL org.opencontainers.image.title="ai-study-assistant-web" \
      org.opencontainers.image.description="Next.js 15 frontend"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
