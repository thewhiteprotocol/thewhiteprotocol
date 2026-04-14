FROM node:18-slim

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy source and build
COPY . .
RUN npm run build

# Expose port
EXPOSE 3000

CMD ["npm", "start"]
