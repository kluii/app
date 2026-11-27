# syntax=docker/dockerfile:1
# One image: build the SPA and the API, then run `prisma migrate deploy` and the server.

FROM node:26-alpine AS build
WORKDIR /app
ENV npm_config_update_notifier=false

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
# No scripts yet: the server's postinstall runs `prisma generate`, and the schema
# only arrives with the source copy below. Generation happens in `npm run build`.
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# The runtime dependency tree, and only that: the server workspace's production
# dependencies minus what an image that runs `node server/dist/server.js` never
# loads. `npm prune --omit=dev` on the full install was not enough — it kept the
# web workspace's production dependencies (lucide-react 48 MB, react-dom,
# @tanstack, @atlaskit) beside a SPA that is already built, plus the
# peer-installed typescript (23 MB) that no runtime file imports.
FROM node:26-alpine AS deps
WORKDIR /app
ENV npm_config_update_notifier=false

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev --workspace @klui/server --ignore-scripts --no-audit --no-fund

# The generated client is the runtime artefact: it carries the engine this image
# loads (libquery_engine-linux-musl-openssl-3.0.x.so.node), so generation happens
# here, on the same base image the runtime uses.
COPY server/prisma ./server/prisma
RUN cd server && node ../node_modules/prisma/build/index.js generate

# typescript is a peerOptional of @prisma/client and prisma, not a dependency of
# the server: no file imports it at runtime.
RUN rm -rf node_modules/typescript
# The Prisma CLI keeps both of its engines: `migrate deploy` refuses to run
# without the query engine beside the schema engine, and it answers "Can't write
# to /app/node_modules/@prisma/engines" rather than a migration error when one is
# missing. The engine the server itself loads is the generated one in
# `.prisma/client`, and that is single-platform: libquery_engine-linux-musl.

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    KLUI_ENV=production \
    KLUI_PORT=8080 \
    KLUI_SECRETS_DIR=/data/secrets

RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
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
