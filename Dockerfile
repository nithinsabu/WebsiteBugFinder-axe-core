FROM node:22-slim

# Install system dependencies for Chromium + wget/gnupg
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libudev1 \
    libuuid1 \
    libx11-6 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
    chromium \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Let Puppeteer know where Chromium is installed
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create working directory
WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build TypeScript (if using TS)
RUN npm run build

# Expose application port
EXPOSE 4000

# Start the app
CMD ["node", "dist/index.js"]
