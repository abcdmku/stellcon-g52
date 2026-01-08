# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy package files for dependency resolution
COPY packages/shared/package.json ./packages/shared/
COPY apps/client/package.json ./apps/client/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/client ./apps/client

# Build shared package first, then client
RUN pnpm --filter @stellcon/shared build
RUN pnpm --filter client build

# Production stage - serve static files with nginx
FROM nginx:alpine AS production

# Copy built assets from builder
COPY --from=builder /app/apps/client/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
