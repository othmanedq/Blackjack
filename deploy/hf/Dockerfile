# Image du Space Hugging Face — le code est copié par le workflow de déploiement.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=7860
CMD ["node", "server.js"]
