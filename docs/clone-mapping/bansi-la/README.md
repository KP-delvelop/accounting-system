# Bansi.la Clone Mapping Workspace

พื้นที่นี้เตรียมไว้สำหรับสำรวจระบบ `bansi.la` / `demo.bansi.la` หลังจากได้รับบัญชีเดโมจากผู้ใช้

## เป้าหมาย

- สำรวจระบบจริงผ่าน browser automation
- เก็บ navigation, form, action, API/network, validation, permission และ side effect
- สร้างรายงานภาษาไทยแบบพร้อมใช้สำหรับ clone phase แรก
- แยกสิ่งที่เห็นจริง (`observed`) ออกจากสิ่งที่อนุมาน (`inferred`)
- โคลน logic, workflow, data flow และ behavior ของระบบให้ครบก่อน เรื่อง UI/visual design แยกเป็น phase ถัดไป
- ออกแบบผลลัพธ์ให้พร้อมย้ายจาก localhost/local storage ไป backend/data store ภายหลัง
- แยกภาษาหน้าจอของระบบต้นทางออกจาก internal domain/API names ของระบบ clone
- เตรียม architecture ให้ AI Agent ใช้ทุกฟังก์ชันได้เหมือน user ปกติภายใต้ role/permission เดียวกัน

## ข้อมูลที่ต้องได้รับก่อนเริ่ม

- URL หน้า login หรือ URL ระบบ demo
- username
- password หรือวิธี login ที่ผู้ใช้ต้องการให้ใช้
- role ของบัญชี เช่น admin, accountant, staff
- module ที่ต้องสำรวจก่อน เช่น รายรับรายจ่าย, invoice, stock, payroll, accounting, reports

## กติกาความปลอดภัย

- ห้ามบันทึกรหัสผ่านลงไฟล์ รายงาน screenshot หรือ log
- ใช้ชื่อ test record ที่มี `CODEX_TEST` เมื่อจำเป็นต้องสร้างข้อมูล
- บัญชีนี้เป็น demo และผู้ใช้อนุญาตให้ทดสอบเชิงลึกได้ รวมถึงสร้าง/แก้ไข/ลบข้อมูลจำลองเพื่อสำรวจ behavior
- การสร้าง/แก้ไข/ลบ test records ภายใน demo account ถือว่าอนุญาตแล้ว
- ก่อนทำรายการที่อาจส่งผลออกนอกระบบ demo เช่น ส่ง email/SMS, payment, publish สู่ภายนอก, เชื่อม third-party, หรือเปลี่ยน credential ต้องหยุดยืนยันอีกครั้ง

## Exploration Permission Snapshot

- ผู้ใช้จะ login บัญชี demo ผ่าน In-App Browser
- อนุญาตให้สำรวจระบบละเอียดทุก module
- อนุญาตให้สร้างข้อมูลปลอม/ข้อมูลจำลอง
- อนุญาตให้ลบหรือแก้ไขข้อมูล demo เพื่อทดสอบ flow
- เป้าหมายคือ clone ทุก function และทุก data/workflow behavior
- UI ไม่ใช่เป้าหมายหลักในรอบแรก
- ระบบ clone จะมี AI Agent เชื่อมต่อในอนาคต
- AI Agent ต้องทำงานผ่าน permission/data-scope/business rules เดียวกับผู้ใช้จริง

## ไฟล์ในโฟลเดอร์นี้

- `checklist.md` รายการสำรวจเชิงละเอียด
- `report.md` โครงรายงาน clone mapping ภาษาไทย
- `i18n-and-seed-data-plan.md` แผนรองรับ 3 ภาษาและข้อมูลจำลอง
- `ai-agent-architecture-notes.md` requirement สำหรับ AI Agent และ permission-aware action layer
- `evidence/` ที่เก็บ screenshot, HAR, network notes หรือ snapshot ที่ไม่ใส่ secret

## Current Implementation Note

แผนล่าสุดเปลี่ยนเป็น localhost-first: Phase 1 ใช้ localhost API + ไฟล์ `data/local-db.json` เป็นฐานข้อมูลเดโมในเครื่องก่อน และมี browser `localStorage` เป็น fallback โดยเตรียม schema/API boundary ไว้สำหรับย้ายขึ้น Hostinger ภายหลัง
