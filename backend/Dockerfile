# Get the base image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files first
COPY package*.json .

# Install dependencies
RUN npm install -g nodemon
RUN npm install

# Copy the rest of the backend code
COPY . . 

# Expose the port the app runs on
EXPOSE 4000

# Start the application
CMD ["npm", "run", "start"]