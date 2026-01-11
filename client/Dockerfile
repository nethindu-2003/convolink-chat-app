# Get the base image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files first
COPY package*.json .

# Install dependencies
RUN npm install
RUN npm install -g serve

# Copy the rest of the backend code
COPY . . 

# Build the React app 
RUN npm run build

# Expose the port the app runs on
EXPOSE 80

# Start the application
CMD ["serve", "-s", "build", "-l", "80"]