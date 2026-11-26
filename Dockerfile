# syntax=docker/dockerfile:1
# One image: build the SPA and the API, then run `prisma migrate deploy` and the server.

FROM node:26-alpine AS build
WORKDIR /app
ENV npm_config_update_notifier=false

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --ignore-scripts=false

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    KLUI_ENV=production \
    KLUI_PORT=8080 \
    KLUI_SECRETS_DIR=/data/secrets

RUN apk add --no-cache openssl

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/web/dist ./web/dist

RUN mkdir -p /data/secrets && chown -R node:node /data/secrets
USER node

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations first, then the server: a failed migration must stop the container,
# never start an API against a schema it does not understand.
CMD ["sh", "-c", "cd server && npx prisma migrate deploy && cd .. && node server/dist/server.js"]
