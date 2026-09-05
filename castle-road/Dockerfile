FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=3000 DATA_FILE=/app/data/rooms.json
EXPOSE 3000
CMD ["node", "server.js"]
