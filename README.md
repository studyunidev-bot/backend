# Demo App Register GAT/PAT API

Backend API สำหรับระบบสมัครสอบและเช็กชื่อ โดยใช้ NestJS, Prisma 7 และ PostgreSQL พร้อม flow หลักดังนี้:

- ระบบ auth แบบ bearer token
- health check ที่เช็ก database จริง
- dashboard summary
- import ข้อมูลจาก Excel
- session-based check-in
- user management สำหรับ admin

## Runtime Notes

repo นี้ใช้ generated Prisma client ใต้ `src/generated/prisma` และ runtime dependency บางส่วนจาก `.deps/` เพราะ environment ปัจจุบันติดปัญหา package resolution บางตัวใน `node_modules` ปกติ

หลัง regenerate Prisma ให้ใช้ script นี้เสมอ:

```bash
npm run prisma:generate
```

## Environment

อ้างอิงค่าตั้งต้นจาก [.env.example](/Users/sriwararak/Desktop/devsriwararak/demo-app-register-gat-pat-api/.env.example)

ค่าที่สำคัญ:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `THROTTLE_TTL_SECONDS`
- `THROTTLE_LIMIT`
- `TRUST_PROXY`

## Run

สำหรับ local dev แนะนำให้รันคู่กับ frontend แบบนี้:

- backend: `http://localhost:3000`
- frontend: `http://localhost:3001`

backend build/start แบบปกติ:

```bash
npm run build
npm run start
```

สำหรับโหมด watch:

```bash
npm run start:dev
```

ถ้ารันผ่าน debugger/watch ใช้:

```bash
npm run start:debug
```

## PM2 on VPS

มี config พร้อมใช้ที่ [ecosystem.config.cjs](/Users/sriwararak/Desktop/devsriwararak/demo-app-register-gat-pat-api/ecosystem.config.cjs)

ตัวอย่าง:

```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

ค่าที่ต้องตั้งก่อน deploy:

- `DATABASE_URL`
- `JWT_SECRET`
- `PORT`
- `TRUST_PROXY`

ถ้า deploy หลัง nginx หรือ load balancer ให้ตั้ง `TRUST_PROXY=true`

## Main Endpoints

Public:

- `GET /`
- `GET /health`
- `POST /register` : bootstrap first user, or admin-only for later users
- `POST /auth/login`

Protected:

- `GET /auth/me`
- `GET /users`
- `POST /users`
- `PATCH /users/:id`
- `GET /dashboard/stats`
- `POST /checkin/session/start`
- `POST /checkin`
- `POST /imports/excel`

## Smoke Test

มี script สำหรับ smoke test flow หลัก:

```bash
bash scripts/smoke-test-api.sh
```

ค่าที่ override ได้:

- `BASE_URL`
- `SMOKE_EMAIL`
- `SMOKE_PASSWORD`

## Production Guidance

- เปลี่ยน `JWT_SECRET` ก่อน deploy
- ห้ามใช้ smoke-test account ใน production
- รันผ่าน reverse proxy ที่บังคับ HTTPS
- ตั้ง `TRUST_PROXY=true` เมื่อ deploy หลัง load balancer หรือ nginx
- ถ้าจะใช้ package security มาตรฐานของ Nest เพิ่มเติม ต้องแก้ปัญหา dependency resolution ของ workspace นี้ก่อน
