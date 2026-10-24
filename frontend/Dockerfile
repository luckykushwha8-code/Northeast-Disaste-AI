# Multi-stage Dockerfile for NE-SAFE AI React frontend
FROM node:22-alpine AS build

WORKDIR /app

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
