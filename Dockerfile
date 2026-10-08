# Imagen para publicar Feria QR en cualquier hosting que acepte Docker.
# Al arrancar crea/verifica las tablas (npm run db:init) y luego inicia el servidor.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=America/Bogota
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:nube"]
