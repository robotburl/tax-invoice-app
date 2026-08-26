# คู่มือ Deploy ขึ้น Railway + ตั้งค่า Google OAuth

## ภาพรวมระบบ
- **Backend**: Node.js + Express
- **Auth**: Google OAuth 2.0 + Session ค้าง 30 วัน
- **Database**: PostgreSQL บน Railway
- **Frontend**: PWA (ติดตั้งบน iPhone เหมือนแอป)

---

## ขั้นตอนที่ 1: สร้าง Google OAuth

1. ไปที่ https://console.cloud.google.com
2. สร้าง Project ใหม่ หรือเลือก Project เดิม
3. ไปที่ **APIs & Services → Credentials**
4. กด **Create Credentials → OAuth 2.0 Client IDs**
5. Application type: **Web application**
6. ตั้งชื่อ: `Tax Invoice App`
7. **Authorized redirect URIs** เพิ่ม:
   ```
   http://localhost:3000/auth/google/callback
   https://YOUR-APP-NAME.railway.app/auth/google/callback
   ```
   (เพิ่ม Railway URL หลังจาก deploy แล้ว)
8. กด Create → คัดลอก **Client ID** และ **Client Secret**

**หมายเหตุ**: ต้องเปิด OAuth consent screen ก่อน:
- User Type: External
- กรอก App name, email
- Scopes: เพิ่ม `email` และ `profile`
- ถ้า Testing mode: เพิ่ม email ที่ใช้ทดสอบใน "Test users"

---

## ขั้นตอนที่ 2: Deploy ขึ้น Railway

### 2.1 เตรียม Repository
```bash
cd tax-invoice-app
git init
git add .
git commit -m "Initial commit"
```

### 2.2 Push ขึ้น GitHub
```bash
# สร้าง repo ใหม่บน GitHub แล้วรัน:
git remote add origin https://github.com/YOUR_USERNAME/tax-invoice-app.git
git push -u origin main
```

### 2.3 สร้าง Project บน Railway
1. ไปที่ https://railway.app → Login
2. กด **New Project → Deploy from GitHub repo**
3. เลือก repo `tax-invoice-app`
4. Railway จะ detect Node.js อัตโนมัติ

### 2.4 เพิ่ม PostgreSQL
1. ในหน้า Project กด **+ Add Service → Database → PostgreSQL**
2. Railway จะสร้าง DB และ set `DATABASE_URL` ให้อัตโนมัติ

### 2.5 ตั้งค่า Environment Variables
ไปที่ **Service → Variables** แล้วเพิ่ม:

| Variable | Value |
|----------|-------|
| `GOOGLE_CLIENT_ID` | จาก Google Console |
| `GOOGLE_CLIENT_SECRET` | จาก Google Console |
| `GOOGLE_CALLBACK_URL` | `https://xxx.railway.app/auth/google/callback` |
| `SESSION_SECRET` | สตริงสุ่มยาวๆ เช่น `abc123xyz...` (อย่างน้อย 32 ตัว) |
| `ALLOWED_EMAILS` | `youremail@gmail.com` (คั่นด้วย `,` ถ้าหลายคน) |
| `NODE_ENV` | `production` |

> **หมายเหตุ**: `DATABASE_URL` Railway ตั้งให้อัตโนมัติแล้ว ไม่ต้องใส่เอง

### 2.6 ได้ URL แล้ว กลับไปอัปเดต Google Console
- เพิ่ม `https://YOUR-APP.railway.app/auth/google/callback`
  ใน Authorized redirect URIs ของ Google OAuth

---

## ขั้นตอนที่ 3: ติดตั้งบน iPhone (PWA)

1. เปิด **Safari** บน iPhone (ต้องเป็น Safari เท่านั้น)
2. ไปที่ URL ของแอป เช่น `https://your-app.railway.app`
3. Login ด้วย Google
4. กดปุ่ม **แชร์** (□↑) ด้านล่าง
5. เลือก **"เพิ่มไปยังหน้าจอโฮม"**
6. กด **"เพิ่ม"**

→ แอปจะปรากฏบน Home Screen เหมือนแอปปกติ
→ เปิดแล้วจะเป็น Fullscreen ไม่มี Browser UI

---

## ขั้นตอนที่ 4: ทดสอบ Local (ก่อน Deploy)

```bash
cd tax-invoice-app
npm install
cp .env.example .env
# แก้ไขค่าใน .env

npm run dev
# เปิด http://localhost:3000
```

---

## ความปลอดภัย

- Session เข้ารหัสและเก็บใน PostgreSQL (ไม่ใช่ cookie ธรรมดา)
- Session อยู่ได้ **30 วัน** (ไม่ต้อง Login ใหม่บ่อย)
- `ALLOWED_EMAILS` จำกัดว่าใคร Login ได้บ้าง
- รูปภาพถูก compress ก่อนเก็บ (JPEG 85%)
- HTTPS บังคับบน Production (Railway ให้มาฟรี)

---

## โครงสร้างไฟล์

```
tax-invoice-app/
├── server.js              # Entry point
├── routes/
│   ├── auth.js            # Passport Google Strategy
│   ├── authRoutes.js      # /auth/google, /auth/logout
│   └── api.js             # /api/companies, /api/invoices
├── public/
│   ├── index.html         # Main app (protected)
│   ├── login.html         # Login page
│   ├── manifest.json      # PWA manifest
│   ├── sw.js              # Service Worker
│   ├── css/app.css        # Styles
│   ├── js/app.js          # Frontend logic
│   └── icons/             # PWA icons
├── package.json
├── .env.example
└── .gitignore
```

---

## แก้ปัญหาที่พบบ่อย

**Login แล้ว redirect วนซ้ำ**
→ ตรวจสอบ `GOOGLE_CALLBACK_URL` ต้องตรงกับที่ตั้งใน Google Console

**Error: "Email not authorized"**
→ เพิ่ม email ของคุณใน `ALLOWED_EMAILS`

**Session หลุดบ่อย**
→ ตรวจสอบ `SESSION_SECRET` ไม่ว่างเปล่า

**PWA ไม่ขึ้นบน iPhone**
→ ต้องเปิดด้วย Safari เท่านั้น ไม่ใช่ Chrome
