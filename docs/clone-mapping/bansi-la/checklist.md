# Bansi.la Detailed Mapping Checklist

## Baseline

- [x] Login สำเร็จด้วยบัญชี demo
- [x] บันทึก landing/dashboard หลัง login
- [x] ระบุ company/profile context: `Thipphavanhtik`
- [x] ระบุภาษาและ currency หลัก: Lao UI, LAK/THB/USD
- [x] บันทึก main navigation จาก DOM
- [ ] ระบุ role/permission แบบละเอียดจาก settings/users

## Navigation

- [x] Dashboard
- [x] Revenue list/create/edit/detail
- [x] Payment list/create/detail
- [x] Invoice list/create/detail
- [x] Bill list/create/detail
- [x] Customer modal create
- [x] Main module tree
- [ ] User/role settings
- [ ] Reports deep dive
- [ ] Inventory/product deep dive
- [ ] Banking/account transfer deep dive

## Forms

- [x] Login/registration baseline
- [x] Revenue create/edit fields
- [x] Payment create fields
- [x] Invoice create fields
- [x] Bill create fields
- [x] Customer modal fields
- [x] Line-item calculation fields
- [ ] Import forms
- [ ] Attachment upload forms
- [ ] Full validation matrix: blank, duplicate, invalid, overlong

## Actions

- [x] Create revenue test record
- [x] Edit revenue line item and amount
- [x] Create payment test record
- [x] Create customer from invoice modal
- [x] Create invoice/quotation test record
- [x] Create bill/purchase-order test record
- [x] Record print/export/email/delete/lock links without executing risky actions
- [x] Inspect invoice/bill status links and `data-method=post` behavior
- [ ] Test duplicate flows
- [ ] Test lock confirmation/state
- [ ] Test delete confirmation without final delete
- [ ] Test invoice/bill payment settlement

## Network/API

- [x] Page routes
- [x] Form action/method for revenue/payment/invoice/bill/customer
- [x] JS/AJAX calculation endpoints observed from page functions
- [x] Route differences: payment duplicate `/duplicates` vs revenue/invoice/bill `/duplicate`
- [ ] HAR-level request/response capture scrubbed of cookies/CSRF
- [ ] API error responses

## Data Lifecycle

- [x] Cash revenue posts journal and dashboard update
- [x] Cash payment posts journal and dashboard update
- [x] Invoice creates document without immediate journal
- [x] Bill creates document without immediate journal
- [x] Customer modal updates parent select2
- [ ] Invoice status transition and settlement
- [ ] Bill status transition and settlement
- [ ] Audit/history expansion

## Clone Output

- [x] Navigation map initial
- [x] Field inventory initial
- [x] Button/action inventory initial
- [x] Route/API inventory initial
- [x] Relationship map initial
- [x] Permission/UI state initial
- [x] Error/edge case initial
- [x] Language/i18n requirements captured
- [x] Seed data records created with `CODEX_TEST`
- [x] AI Agent action contract draft
- [x] Hosted database schema notes draft
- [x] Local-first localhost prototype started
- [x] Host-ready Postgres schema draft
- [x] Unified frontend/API seed source
- [x] Local API reset flow wired to `/api/reset`
- [x] Form validation errors shown in UI
- [x] Local API action endpoint wired for UI and future AI Agent callers
- [x] Invoice/bill status transition actions started
- [x] Shared accounting engine used by frontend fallback and local API
- [x] Local API action errors mapped to 400/403/404/500 classes
- [x] Customer/vendor create actions added for UI and future AI Agent callers
- [x] Invoice/bill forms can create and select contacts inline
- [ ] Hosted database migrations after Hostinger target is confirmed
- [ ] Permission/app-layer access policy draft after backend target is confirmed
- [ ] Acceptance tests / fixtures
