# Self-hosted web build of the app (PWA). Independent from mobile/Dockerfile, which Railway uses.
# Build context is the repository root:
#   docker build -f deploy/web/Dockerfile --build-arg EXPO_PUBLIC_API_URL=https://api.example.com .
# EXPO_PUBLIC_API_URL is baked into the bundle at build time.
FROM node:24-alpine AS build
WORKDIR /app
COPY mobile/package.json mobile/package-lock.json ./
# postinstall copies the MapLibre worker into public/.
COPY mobile/scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY mobile/ .
ARG EXPO_PUBLIC_API_URL
RUN test -n "$EXPO_PUBLIC_API_URL" || (echo "Set EXPO_PUBLIC_API_URL (https://... of the API)" && exit 1)
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN npx expo export --platform web --output-dir dist

FROM caddy:2-alpine
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
# 80 for HTTP; 443 only matters when SITE_ADDRESS is a domain (automatic HTTPS).
EXPOSE 80 443
