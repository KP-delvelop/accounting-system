# Currency / Language Separation + Per-Form Currency Selection

Scope: local-only frontend/API compatibility pass for separating UI language from transaction/document currency. This does not touch real Bansi, external services, deployment, or production profile architecture.

## Implemented

- Money formatting now accepts a UI locale separately from the currency code.
  - Thai UI shows LAK as `กีบ`, THB as `บาท`, and USD as `ดอลลาร์สหรัฐ`.
  - Lao UI keeps Lao currency labels.
  - English UI uses currency codes (`LAK`, `THB`, `USD`).
- Dashboard and module summary totals now group cash/document amounts by their own currency instead of summing mixed currencies into one LAK-looking number.
- Cash revenue and cash payment forms now expose a `Currency` selector.
  - The selector filters the cash/bank account list to accounts in that currency.
  - The transaction currency is still derived from the selected cash/bank account, preserving existing accounting behavior.
- Sales invoice and purchase bill forms now expose a document `Currency` selector.
  - Selecting or creating a contact still defaults the document currency to the contact currency for compatibility with existing FX flows.
  - Users can override the document currency before save.
  - `sales_document.create` and `purchase_document.create` now accept optional `currency`; if omitted, they continue to fall back to the contact currency.
- Line item totals and report/table money displays use the current UI locale while retaining each row's stored currency.

## Deferred / Not Implemented

- CNY/yuan is not added in this pass. The current seed chart and settlement/accounting tests cover LAK, THB, and USD only; adding CNY safely should include seed accounts, allowed-currency policy, report/export fixtures, settlement validation expectations, and UAT sign-off.
- Product/service master currency is not added in this pass. Product prices remain simple/base-price inputs. Per-document/per-cash currency determines the transaction/document currency at posting time.
- No user/company profile system is implemented yet.

## Future SaaS/Profile Notes

Future profile/company settings should define:

- default language,
- default base/display currency,
- allowed transaction/document currencies,
- default document currency behavior per customer/vendor,
- whether products/services have base prices only or per-currency price lists,
- CNY/yuan enablement and exchange-rate policy.

## Targeted Test Coverage

- API smoke verifies `sales_document.create` can persist a selected document currency independently of the contact currency.
- UI smoke verifies Thai locale does not display the Lao kip label for LAK money.
- UI smoke verifies sales and purchase document currency selectors default to USD when a USD contact/vendor is selected and persist USD on the created document.

## Tester Scope

Review only this module:

- Thai/English/Lao money labels for LAK/THB/USD,
- cash revenue/payment currency selector and account filtering,
- invoice/bill document currency selector and payload persistence,
- existing FX settlement flows still using document currency and settlement exchange rate,
- summary/table displays grouping by stored record currency.
