# Bansi.la I18n and Seed Data Plan

## Supported Languages

Clone app ต้องรองรับ 3 ภาษา:

| Code | Language | Usage |
| --- | --- | --- |
| `en` | English | Secondary UI language and fallback |
| `th` | Thai | Required UI language |
| `lo` | Lao | Primary language parity with Bansi.la |

## I18n Requirements

- ทุกเมนู ปุ่ม label placeholder help text validation message notification และ error ต้องมี translation key
- ห้าม hardcode ข้อความใน component หรือ business logic
- เก็บ default locale ระดับ user/company ได้
- ต้องรองรับการ switch ภาษาโดยไม่ทำให้ data flow เปลี่ยน
- format วันที่ เวลา ตัวเลข สกุลเงิน และภาษีต้องแยกจาก translation text
- master data ที่เป็นชื่อธุรกิจจริง เช่น product, customer, account name ต้องรองรับชื่อหลายภาษาเมื่อระบบ demo แสดงหลายภาษา
- audit/report/export ต้องระบุ locale ที่ใช้สร้างเอกสาร

## Suggested Translation Key Pattern

```text
module.section.element.state
```

ตัวอย่าง:

| Key | en | th | lo |
| --- | --- | --- | --- |
| `common.action.save` | Save | บันทึก | ບັນທຶກ |
| `common.action.cancel` | Cancel | ยกเลิก | ຍົກເລີກ |
| `common.action.delete` | Delete | ลบ | ລຶບ |
| `common.validation.required` | This field is required | กรุณากรอกข้อมูล | ກະລຸນາປ້ອນຂໍ້ມູນ |
| `common.status.active` | Active | ใช้งาน | ໃຊ້ງານ |

## Hosted Data Model Notes

ตัวเลือกที่ควรพิจารณา:

| Pattern | Use For | Notes |
| --- | --- | --- |
| `translations` table | UI labels, validation messages, static text | `key`, `locale`, `value`, `namespace` |
| JSONB translation column | Master data names/descriptions | เช่น `name_i18n jsonb` เก็บ `{ "en": "...", "th": "...", "lo": "..." }` |
| Locale columns | Reports/export snapshots | เช่น `locale`, `generated_label_snapshot` |

## Seed Data Policy

ถ้า demo account ไม่มีข้อมูล สามารถสร้างข้อมูลจำลองได้ทันที โดยใช้ prefix:

```text
CODEX_TEST
```

หลักการ:

- ใช้ข้อมูลปลอมเท่านั้น
- ไม่ใช้เบอร์โทร/email จริง ยกเว้นรูปแบบ reserved เช่น `codex.test+...@example.com`
- สร้างข้อมูลให้ครบ relation เพื่อทดสอบ flow เช่น customer -> invoice -> payment -> report
- สร้าง edge cases ด้วย เช่น duplicate, missing required, invalid amount, inactive record
- ลบ/แก้ไขข้อมูล `CODEX_TEST` ได้เพื่อทดสอบ behavior

## Initial Seed Dataset Ideas

| Module | Test Records |
| --- | --- |
| Company/Profile | `CODEX_TEST Trading Co., Ltd.` |
| Customers | `CODEX_TEST Customer Retail`, `CODEX_TEST Customer Credit` |
| Vendors | `CODEX_TEST Vendor Supplies` |
| Products/Services | `CODEX_TEST Product A`, `CODEX_TEST Service Consulting` |
| Warehouse/Stock | `CODEX_TEST Main Warehouse`, stock quantity 10/0/negative edge if allowed |
| Income/Expense | sample income, sample expense, VAT/non-VAT cases |
| Invoice | draft, confirmed, paid, overdue if statuses exist |
| Payroll | demo employee and payroll run if available |
| Accounting | account mapping, journal entry if available |
| Reports | date range with/without data |

## Evidence To Capture During Mapping

- Language switch location and behavior
- Current locale source: URL, cookie, localStorage, profile setting, company setting, or API
- Whether API responses contain translation strings or raw data only
- Validation messages in each language
- Export/print language behavior
- Data fields that need multilingual storage
- Any missing translation or mixed-language screens
