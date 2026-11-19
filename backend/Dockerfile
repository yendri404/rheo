FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
USER node
EXPOSE 3000
# Node runs TypeScript directly (type stripping), so there is no build step.
CMD ["node", "src/server.ts"]
