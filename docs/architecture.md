# SaaS MVP 设计（账票系统）

## 1. 目标范围（本期）
- 登录/注册（邮箱+密码）
- 多租户（每个账号默认一个公司租户）
- 公司预设信息（名称/地址/注册号/银行）
- 印章上传（存储文件路径）
- 商品目录（常用销售品）
- 领収书管理：新建、保存、发送、列表查询
- 收入台账：按领収日期汇总月收入、年收入

## 2. 状态流转
- receipt.status = `saved` | `sent`
- saved -> sent（记录 sent_at / sent_by）

## 3. 数据模型（SQLite）
- users
  - id, email(unique), password_hash, created_at
- tenants
  - id, owner_user_id, name, created_at
- memberships
  - id, tenant_id, user_id, role(owner/admin/member)
- company_profiles
  - id, tenant_id(unique), company_name, address, phone, registration_no, bank_info, stamp_path, updated_at
- products
  - id, tenant_id, name, default_tax_rate(8/10), default_unit_price, note, created_at, updated_at
- receipts
  - id, tenant_id, receipt_no, customer_name, receipt_date, status(saved/sent), sent_at, sent_by, memo, subtotal, tax_8, tax_10, total, created_at, updated_at
- receipt_items
  - id, receipt_id, product_name, qty, unit_price_input, input_mode(inclusive/exclusive), tax_rate, base_amount, tax_amount, total_amount

## 4. API 设计（REST）
- Auth
  - POST /api/auth/register
  - POST /api/auth/login
  - GET /api/auth/me
- Company
  - GET /api/company
  - PUT /api/company
  - POST /api/company/stamp (multipart)
- Products
  - GET /api/products
  - POST /api/products
  - PUT /api/products/:id
  - DELETE /api/products/:id
- Receipts
  - GET /api/receipts?status=&from=&to=&q=
  - GET /api/receipts/:id
  - POST /api/receipts
  - PUT /api/receipts/:id
  - POST /api/receipts/:id/send
- Ledger
  - GET /api/ledger/summary?year=2026
  - 返回 month_total[1..12], year_total

## 5. 关键规则
- 税额按税率分组后，每税率仅一次端数处理。
- 领収书统计以 receipt_date 为准。
- sent 状态必须记录 sent_at 和 sent_by。

## 6. 前端页面（本期）
- /login.html
- /app.html（单页：公司设置、商品库、领収书列表、领収书编辑、月/年汇总）

## 7. 后续可扩展
- 请求书/纳品书表结构复用 receipts 逻辑扩展为 documents(type)
- 邮件发送与送达回执
- PDF 服务端生成与电子签章
