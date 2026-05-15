FROM node:24-slim

WORKDIR /app

COPY package.json ./
COPY server.js db.js ./
COPY public ./public

ENV NODE_ENV=production
ENV SQLITE_PATH=/var/data/adsflow.sqlite

EXPOSE 3000

CMD ["node", "server.js"]
