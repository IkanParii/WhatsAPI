# WhatsAPI

API WhatsApp ringan berbasis Node.js (@whiskeysockets/baileys) & Express dengan dukungan Web GUI Dashboard dan Docker.

## Fitur
1. **Web GUI Dashboard**: Akses via browser untuk memantau status, scan QR Code WhatsApp secara visual, dan form kirim pesan langsung.
2. **HTTP API**: Mengirim pesan ke kontak personal maupun grup (`POST /send`).
3. **Keamanan (Security)**: Proteksi `API_KEY` untuk mencegah akses liar saat dipublikasikan di VPS publik.
4. **Listener Bot**: Membaca pesan masuk di grup dan kontak pribadi, hanya merespon perintah dengan prefix `nad,`.
5. **Persistent Session**: Menggunakan Docker Volume agar sesi login WhatsApp tetap tersimpan saat container di-restart.

---

## 🔒 Konfigurasi Keamanan (Wajib untuk VPS)

Sebelum menjalankan di VPS yang terhubung ke internet:
1. Salin file konfigurasi environment:
   ```bash
   cp .env.example .env
   ```
2. Buka `.env` dan atur `API_KEY` rahasia Anda:
   ```env
   PORT=3000
   API_KEY=kunci_rahasia_anda_di_sini
   ```
*Jika `API_KEY` diaktifkan, semua request ke API dan Web GUI wajib menyertakan API Key tersebut via header `x-api-key`.*

---

## Cara Menjalankan di VPS (Docker)

### 1. Clone & Jalankan Container
```bash
git clone <url-repo>
cd WhatsAPI
docker compose up -d --build
```

### 2. Hubungkan WhatsApp (Scan QR Code)
Anda memiliki dua cara mudah:
- **Cara 1 (Web Dashboard - Rekomendasi)**: Buka browser ke `http://<IP-VPS-ANDA>:3000`, masukkan API Key (jika diatur), lalu scan QR Code yang muncul di layar web menggunakan WhatsApp HP (Perangkat Tertaut).
- **Cara 2 (Terminal Log)**:
  ```bash
  docker compose logs -f
  ```
  Scan QR yang muncul di konsol terminal.

---

## Web GUI Dashboard
Buka `http://localhost:3000` atau `http://<IP-VPS>:3000` di browser:
- Tampilan status koneksi real-time.
- QR Code live auto-refresh.
- Form langsung untuk mengirim pesan teks ke kontak atau grup.

---

## Penggunaan HTTP API

### 1. Cek Status Koneksi
```bash
curl http://localhost:3000/status \
  -H "x-api-key: kunci_rahasia_anda_di_sini"
```
Response:
```json
{ 
  "connected": true, 
  "qr": null, 
  "requiresAuth": true 
}
```

### 2. Kirim Pesan
Kirim request `POST` ke `/send`:
```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: kunci_rahasia_anda_di_sini" \
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