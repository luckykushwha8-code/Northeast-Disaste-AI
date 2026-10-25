# Multi-stage Dockerfile for NE-SAFE AI React frontend
FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
ARG VITE_MAPTILER_API_KEY=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_MAPTILER_API_KEY=${VITE_MAPTILER_API_KEY}

# Install npm dependencies
COPY package*.json ./
RUN npm ci

# Copy source and compile production bundle
COPY . .
RUN npm run build

# Serve stage using lightweight Nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# SPA Routing Nginx configuration
RUN echo 'server { \
    listen 5173; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
