# Web GUI Design for WhatsAPI

## Overview
A lightweight web interface served directly by Express to monitor WhatsApp connection status, display QR code for scanning in the browser, and provide a form to send WhatsApp messages.

## Architecture
- Served statically via `express.static('public')` from `public/index.html`.
- Uses `qrcode` npm package or client-side QR renderer to render QR code on canvas/SVG.
- Backend provides:
  - `GET /status`: Returns `{ connected: boolean, qr: string | null }`.
  - `POST /send`: Sends WhatsApp message.
- Frontend: Single-page application with responsive UI, auto-polling `/status` every 3 seconds.
