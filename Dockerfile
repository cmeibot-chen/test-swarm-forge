FROM node:24.13.0-alpine3.22 AS deps
WORKDIR /app
RUN npm install --global npm@9.2.0
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund --prefer-offline --maxsockets=4 \
    --fetch-retries=5 --fetch-retry-factor=2 \
    --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=30000

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24.13.0-alpine3.22 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
