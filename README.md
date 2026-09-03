# WhatsAPI

API WhatsApp ringan berbasis Node.js (@whiskeysockets/baileys) & Express dengan dukungan Docker.

## Fitur
1. **HTTP API**: Mengirim pesan ke kontak personal maupun grup (`POST /send`).
2. **Listener Bot**: Membaca pesan masuk di grup dan kontak pribadi, hanya merespon perintah dengan prefix `nad,`.
3. **Persistent Session**: Menggunakan Docker Volume agar tidak perlu scan QR ulang saat container di-restart.

---

## Cara Menjalankan di VPS (Docker)

### 1. Clone & Jalankan Container
```bash
git clone <url-repo>
cd WhatsAPI
docker compose up -d --build
```

### 2. Scan QR Code WhatsApp
Untuk pertama kali login, pantau log container:
```bash
docker compose logs -f
```
Scan QR code yang muncul di terminal menggunakan WhatsApp di HP Anda (Perangkat Tertaut / Linked Devices). Setelah tertaut, sesi tersimpan di folder `auth_info_baileys/`.

---

## Penggunaan API

### Cek Status Koneksi
```bash
curl http://localhost:3000/status
```
Response:
```json
{ "connected": true }
```

### Kirim Pesan
Kirim request `POST` ke `/send`:
```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "628123456789",
    "message": "Halo dari WhatsAPI!"
  }'
```
> **Catatan untuk parameter `to`**:
> - Nomor personal: masukkan nomor berawalan kode negara (misal `628123456789`).
> - Grup: masukkan JID lengkap grup (misal `12036302xxxx@g.us`).

---

## Listener Bot (Prefix `nad,`)

Bot otomatis mendengarkan pesan baik di **Chat Pribadi** maupun **Grup WhatsApp**.
Jika ada pesan diawali dengan `nad,` (contoh: `nad, halo apa kabar`), bot akan membalas pesan tersebut.