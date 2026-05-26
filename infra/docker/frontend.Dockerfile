FROM node:22-alpine

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* /app/frontend/
RUN cd /app/frontend && npm install
COPY frontend /app/frontend

EXPOSE 5173
CMD ["npm", "--prefix", "frontend", "run", "dev", "--", "--host", "0.0.0.0"]
