# WhatsApp API & Bot Design

## Overview
A lightweight WhatsApp integration designed to run in a Docker container on a VPS. It serves two purposes:
1. Provide an HTTP API to send messages out to contacts or groups.
2. Listen to incoming messages in groups and personal chats, responding only to commands prefixed with `nad,`.

## Architecture
- **Language**: Node.js
- **WhatsApp Library**: `@whiskeysockets/baileys` (WebSocket-based, no headless browser required, minimal RAM footprint)
- **HTTP Server**: `express`
- **Deployment**: Docker (`node:18-alpine` or `20-alpine`)

## Components

### 1. WhatsApp Connection Manager
- Initializes Baileys connection.
- Uses `useMultiFileAuthState` to save session data in `./auth_info`.
- Generates a QR code in the terminal logs on the first run.
- Automatically reconnects on disconnects.

### 2. HTTP API (Express)
- **Endpoint**: `POST /send`
- **Payload**:
  ```json
  {
    "to": "628123456789@s.whatsapp.net",
    "message": "Hello from API"
  }
  ```
- **Response**: Success/Failure status.

### 3. Message Listener
- Subscribes to `messages.upsert`.
- Ignores messages sent by the bot itself (`!msg.key.fromMe`).
- Checks if the message body starts with `nad, ` or `nad,` (case-insensitive).
- If matched, routes to a command handler (initially a basic reply/echo placeholder for future permission-based logic).

## Infrastructure & Persistence
- `Dockerfile` to package the application.
- `docker-compose.yml` to define the service and mount the `./auth_info` directory as a volume. This ensures the WhatsApp session survives container restarts without requiring a new QR scan.
