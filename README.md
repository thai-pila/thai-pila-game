# thai-pila-game

เกม THAI PILA บน Phaser 3 + Webpack + TypeScript

## ความต้องการของระบบ

- [Node.js](https://nodejs.org/) 18 ขึ้นไป
- npm

## ติดตั้งและรันบน Local

### 1. ติดตั้ง dependencies

```bash
npm install
```

### 2. ชี้ API (ถ้าต้องการใช้ backend บนเครื่องตัวเอง)

ค่าเริ่มต้นในโค้ดชี้ไป production:

```ts
// src/core/api.ts
export const API_BASE_URL = "https://thaipilacreate.eef.or.th/api";
```

ถ้าจะยิง `thai-pila-api` บน local ให้เปลี่ยนเป็น:

```ts
export const API_BASE_URL = "http://localhost:3001";
```

> อย่า commit URL / credential ของเซิร์ฟเวอร์ภายในที่ไม่ควรเผยแพร่

### 3. รัน development server

```bash
npm run dev
```

Webpack dev server จะเปิดที่ [http://localhost:3001](http://localhost:3001)

**หมายเหตุ:** พอร์ต `3001` ชนกับ `thai-pila-api`  
ถ้ารันทั้งคู่พร้อมกัน ให้เปลี่ยนพอร์ตใน `webpack/webpack.dev.js` เช่น:

```js
devServer: {
  port: 8080,
  // ...
}
```

แล้วเปิด [http://localhost:8080](http://localhost:8080) แทน

### 4. ทดสอบเกมแบบไม่มี URL params

ถ้าเปิดหน้าเปล่าโดยไม่มี query string เกมจะใช้ UUID fallback ใน `src/main.ts` (`DEV_FALLBACK_*`)  
แก้ UUID เหล่านั้นให้ตรงกับข้อมูลในฐานข้อมูลของคุณเมื่อทดสอบ local

ตัวอย่าง URL เมื่อมี uuid จริง:

```text
http://localhost:8080/?game=<game-uuid>
http://localhost:8080/?sequence=<sequence-uuid>
```

## สคริปต์

| คำสั่ง | คำอธิบาย |
|--------|----------|
| `npm run dev` | รัน webpack-dev-server (hot reload) |
| `npm run build` | build production ไปที่โฟลเดอร์ `dist` |
| `npm run build:dev` | build ด้วย config development |

## Deploy

```bash
npm run build
```

อัปโหลดเนื้อหาทั้งหมดในโฟลเดอร์ `dist` ไปยัง web server

## โครงสร้างที่เกี่ยวข้อง

| โปรเจค | บทบาท |
|--------|--------|
| `thai-pila-api` | Backend ที่เสิร์ฟข้อมูลเกม |
| `thai-pila-create` | สร้างและแก้เนื้อหาเกม |
| `thai-pila-web` | เว็บหน้าบ้าน |
