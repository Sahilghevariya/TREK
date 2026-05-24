# TREK

Travel Resource & Exploration Kit

TREK is a self-hosted MERN stack travel planner for managing trips, maps, budgets, memories, notifications, uploads, and real-time planning workflows. Vacay and Atlas remain available as core navigation modules.

## Stack

- MongoDB with Mongoose
- Express and Node.js
- React and Vite
- WebSocket support
- PWA support

## Local Setup

Create environment files with the local MongoDB connection:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/trek-main
```

Install dependencies and start the app:

```bash
npm install
npm run dev
```

The API runs on port `5000` by default, and the client runs through the Vite dev server.

## Features

- Authentication and user sessions
- Trip planning dashboard
- Vacay travel tools
- Atlas map tools
- Notifications and offline support
- Uploads and photo memories
- PWA install experience
- MongoDB-backed API routes
