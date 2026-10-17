# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build

# Stage 2: Production Node.js Runner (backend has zero npm dependencies)
FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    PORT=8388

WORKDIR /app

COPY backend/package.json /app/package.json
COPY backend/src /app/src
COPY backend/config.example.json /app/config.example.json
COPY --from=frontend-builder /app/frontend/dist /app/dashboard_dist

EXPOSE 8388

CMD ["node", "src/index.js"]
