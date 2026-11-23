# Web build of the app (PWA), served as static files by Caddy.
# EXPO_PUBLIC_API_URL is baked into the bundle at build time, so pass it as a build arg
# (Railway passes service variables to matching ARGs automatically).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# postinstall copies the MapLibre worker into public/.
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY . .
ARG EXPO_PUBLIC_API_URL
RUN test -n "$EXPO_PUBLIC_API_URL" || (echo "Set EXPO_PUBLIC_API_URL (https://... of the API)" && exit 1)
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN npx expo export --platform web --output-dir dist

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
# Caddy listens on $PORT (set by Railway), 8080 otherwise. TLS is terminated by the platform.
EXPOSE 8080
