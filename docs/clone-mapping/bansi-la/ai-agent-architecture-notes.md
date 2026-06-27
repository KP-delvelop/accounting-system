# AI Agent Architecture Notes

## Core Requirement

ระบบ clone ต้องเตรียมให้ AI Agent เชื่อมต่อภายหลัง และ AI Agent ต้องสามารถใช้งานฟังก์ชันระบบได้เหมือน user ปกติ ภายใต้ role และ permission เดียวกัน

## Language Boundary

ภาษาที่ใช้เขียนระบบ clone อาจต่างจากภาษาของระบบต้นทาง ดังนั้น mapping ต้องแยกระหว่าง:

| Layer | Requirement |
| --- | --- |
| Source UI language | Lao/Thai/English labels from Bansi.la |
| Internal domain language | Stable English code identifiers for tables, APIs, services, enums |
| Translation layer | `en`, `th`, `lo` labels/messages via i18n keys |
| AI tool language | Stable action names and schemas, preferably English identifiers with localized descriptions |

หลักการ:

- ห้ามผูก business logic กับข้อความ UI ของระบบต้นทาง
- ใช้ชื่อ domain/API ที่เสถียร เช่น `customer.create`, `invoice.approve`, `inventory.adjust`
- เก็บ mapping จาก label ภาษา Lao/Thai/English ไปยัง internal action/table/field name
- ทุก enum/status ต้องมี internal code เช่น `draft`, `approved`, `paid`, `voided` และมี translation แยก

## AI Agent Capability Model

AI Agent ควรเรียกใช้ระบบผ่าน capability/action layer เดียวกับ user workflow:

| Capability Type | Examples | Notes |
| --- | --- | --- |
| Read | search customers, view invoice, get report | ต้อง respect role/permission/data scope |
| Create | create customer, create invoice, create expense | ใช้ validation เดียวกับ UI |
| Update | edit product, update payment status | ต้องมี audit trail |
| Delete/Cancel | delete draft, void invoice, cancel document | ต้องเช็ค permission/state |
| Workflow | approve, post stock, close period | อาจต้อง confirmation policy |
| Export/Report | generate report, export PDF/CSV | ต้อง log locale and parameters |

## Permission Rules

- AI Agent ต้องถูกผูกกับ user, company/tenant, role และ permission scope
- AI Agent ห้าม bypass tenant scope หรือ business permission
- ทุก action ของ AI ต้องตรวจสิทธิ์แบบเดียวกับ UI
- การกระทำของ AI ต้องมี audit metadata เช่น `actor_type = ai_agent`, `actor_user_id`, `agent_id`, `reason`, `request_id`
- ถ้า user role ทำไม่ได้ AI Agent ที่ทำงานแทน user คนนั้นก็ต้องทำไม่ได้

## Hostinger/API Design Notes

| Area | Suggested Design |
| --- | --- |
| Auth | AI Agent ทำงานผ่าน service layer ที่ impersonate user อย่างปลอดภัย หรือใช้ agent identity ที่ map กับ user/role |
| Access rules | API/service layer ต้องเช็ค tenant/company และ role/permission ทุก action |
| Audit | ตาราง `audit_logs` เก็บ user/agent action ทุกครั้ง |
| Action schema | ตารางหรือ config สำหรับ `ai_actions` ระบุ name, input schema, permission, risk level |
| API endpoints | ใช้ controlled tool endpoints สำหรับ AI เช่น `create_invoice`, `search_inventory`, `generate_report` |
| Confirmations | action เสี่ยง เช่น delete, approve, post, send external message ต้องมี policy ระบุว่าต้อง confirm หรือไม่ |

## Mapping Evidence To Capture

ตอนสำรวจระบบต้นทาง ให้เก็บข้อมูลต่อไปนี้เพื่อรองรับ AI Agent:

- action ทุกปุ่มและทุก flow แปลงเป็น internal action name ได้อย่างไร
- required fields และ validation ที่ AI ต้อง obey
- state machine ของเอกสาร เช่น draft -> approved -> paid -> voided
- permission/state ที่ทำให้ action ซ่อนหรือ disabled
- side effects หลัง action เช่น stock movement, ledger posting, notification, report updates
- error messages และ recovery steps
- idempotency/duplicate behavior เช่น กด save ซ้ำเกิดอะไร

## Agent-Friendly API Contract Draft

ตัวอย่างรูปแบบ action:

```json
{
  "action": "invoice.create",
  "actor": {
    "type": "ai_agent",
    "user_id": "<user-id>",
    "role": "accountant"
  },
  "input": {
    "customer_id": "<customer-id>",
    "issue_date": "2026-06-24",
    "line_items": []
  },
  "locale": "lo",
  "dry_run": false
}
```

ทุก action ควร return:

```json
{
  "ok": true,
  "data": {},
  "warnings": [],
  "next_allowed_actions": [],
  "audit_id": "<audit-id>"
}
```

## Clone Acceptance Criteria For AI-Ready Phase

- ทุกฟังก์ชันหลักมี internal action name และ input/output contract
- Permission ของ AI Agent เท่ากับ user role ที่ผูกอยู่
- AI Agent ใช้ validation/business rules ชุดเดียวกับ UI
- ทุก AI action มี audit log
- มี dry-run หรือ preview สำหรับ action เสี่ยง
- Translation/i18n แยกจาก action contract
