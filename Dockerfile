# Dockerfile (Railway/VPS)
FROM ghcr.io/puppeteer/puppeteer:23.6.0
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
