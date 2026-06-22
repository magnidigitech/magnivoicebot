# Use the official lightweight Node.js image
FROM node:20-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy dependency configuration files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy application files (respecting .dockerignore)
COPY . .

# Expose the application port
EXPOSE 3000

# Define the start command
CMD [ "npm", "start" ]
