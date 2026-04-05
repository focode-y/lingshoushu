import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { jsondb } from './db.js';

const app = express();
const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const now = () => new Date().toISOString();

const uploadDir = path.resolve('uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use('/uploads', express.static(uploadDir));
app.use('/', express.static(path.resolve('web')));

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: '未登录' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: '登录已失效' }); }
}

function addLog(db, tenantId, userId, action, detail = '') {
  db.audit_logs.push({ id: jsondb.nextId(db, 'audit_logs'), tenant_id: tenantId, user_id: userId, action, detail, created_at: now() });
}

function computeItems(items, roundingMode = 'round') {
  const roundBy = (n) => roundingMode === 'floor' ? Math.floor(n) : roundingMode === 'ceil' ? Math.ceil(n) : Math.round(n);
  const rows = (items || []).map((r) => ({
    product_name: r.product_name || '', qty: Number(r.qty || 0), unit_price_input: Number(r.unit_price_input || 0),
    input_mode: r.input_mode === 'exclusive' ? 'exclusive' : 'inclusive', tax_rate: Number(r.tax_rate) === 8 ? 8 : 10,
  }));
  const baseByRate = { 8: 0, 10: 0 };
  const baseRows = rows.map((r) => {
    if (!r.qty || !r.unit_price_input) return { ...r, base_amount: 0 };
    if (r.input_mode === 'inclusive') {
      const incl = r.qty * r.unit_price_input;
      const base = roundBy(incl / (1 + r.tax_rate / 100));
      baseByRate[r.tax_rate] += base;
      return { ...r, base_amount: base };
    }
    const base = r.qty * r.unit_price_input;
    baseByRate[r.tax_rate] += base;
    return { ...r, base_amount: base };
  });
  const tax8 = roundBy(baseByRate[8] * 0.08);
  const tax10 = roundBy(baseByRate[10] * 0.10);
  const result = baseRows.map((r) => {
    const denom = baseByRate[r.tax_rate] || 0;
    const taxPool = r.tax_rate === 8 ? tax8 : tax10;
    const tax = denom ? roundBy(taxPool * (r.base_amount / denom)) : 0;
    return { ...r, tax_amount: tax, total_amount: r.base_amount + tax };
  });
  return { items: result, subtotal: baseByRate[8] + baseByRate[10], tax_8: tax8, tax_10: tax10, total: baseByRate[8] + baseByRate[10] + tax8 + tax10 };
}

app.post('/api/auth/register', (req, res) => {
  const { email, password, companyName } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码必填' });
  const db = jsondb.load();
  if (db.users.some((x) => x.email === email)) return res.status(409).json({ error: '邮箱已注册' });

  const uid = jsondb.nextId(db, 'users');
  db.users.push({ id: uid, email, password_hash: bcrypt.hashSync(password, 10), created_at: now() });
  const tid = jsondb.nextId(db, 'tenants');
  db.tenants.push({ id: tid, owner_user_id: uid, name: companyName || `${email} 的公司`, created_at: now() });
  db.memberships.push({ id: jsondb.nextId(db, 'memberships'), tenant_id: tid, user_id: uid, role: 'owner' });
  db.company_profiles.push({ id: db.company_profiles.length + 1, tenant_id: tid, company_name: '', address: '', phone: '', registration_no: '', bank_info: '', stamp_path: '', updated_at: now() });
  addLog(db, tid, uid, 'auth.register', email);
  jsondb.save(db);

  const token = jwt.sign({ userId: uid, tenantId: tid, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const db = jsondb.load();
  const u = db.users.find((x) => x.email === email);
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) return res.status(401).json({ error: '账号或密码错误' });
  const m = db.memberships.find((x) => x.user_id === u.id);
  addLog(db, m.tenant_id, u.id, 'auth.login', email);
  jsondb.save(db);
  const token = jwt.sign({ userId: u.id, tenantId: m.tenant_id, email: u.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ userId: req.user.userId, tenantId: req.user.tenantId, email: req.user.email }));

app.post('/api/account/change-password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '旧密码和新密码必填' });
  const db = jsondb.load();
  const user = db.users.find((x) => x.id === req.user.userId);
  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) return res.status(400).json({ error: '旧密码错误' });
  user.password_hash = bcrypt.hashSync(newPassword, 10);
  addLog(db, req.user.tenantId, req.user.userId, 'account.change_password', 'self');
  jsondb.save(db);
  res.json({ ok: true });
});

app.get('/api/company', auth, (req, res) => {
  const db = jsondb.load();
  res.json(db.company_profiles.find((x) => x.tenant_id === req.user.tenantId) || {});
});

app.put('/api/company', auth, (req, res) => {
  const db = jsondb.load();
  const row = db.company_profiles.find((x) => x.tenant_id === req.user.tenantId);
  Object.assign(row, req.body || {}, { updated_at: now() });
  addLog(db, req.user.tenantId, req.user.userId, 'company.update', row.company_name || '');
  jsondb.save(db);
  res.json({ ok: true });
});

app.post('/api/company/stamp', auth, upload.single('stamp'), (req, res) => {
  const db = jsondb.load();
  const row = db.company_profiles.find((x) => x.tenant_id === req.user.tenantId);
  row.stamp_path = req.file ? `/uploads/${path.basename(req.file.path)}` : '';
  row.updated_at = now();
  addLog(db, req.user.tenantId, req.user.userId, 'company.upload_stamp', row.stamp_path);
  jsondb.save(db);
  res.json({ stamp_path: row.stamp_path });
});

app.get('/api/products', auth, (req, res) => {
  const db = jsondb.load();
  res.json(db.products.filter((x) => x.tenant_id === req.user.tenantId).sort((a, b) => b.id - a.id));
});

app.post('/api/products', auth, (req, res) => {
  const { name, code = '', default_tax_rate = 10, default_unit_price = 0, note = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: '名称必填' });
  const db = jsondb.load();
  if (code && db.products.some((x) => x.tenant_id === req.user.tenantId && x.code === code)) return res.status(409).json({ error: '商品编码已存在' });
  db.products.push({ id: jsondb.nextId(db, 'products'), tenant_id: req.user.tenantId, code, name, default_tax_rate: Number(default_tax_rate) === 8 ? 8 : 10, default_unit_price: Number(default_unit_price || 0), note, created_at: now(), updated_at: now() });
  addLog(db, req.user.tenantId, req.user.userId, 'product.create', name);
  jsondb.save(db);
  res.json({ ok: true });
});

app.put('/api/products/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const { name, code = '', default_tax_rate = 10, default_unit_price = 0, note = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: '名称必填' });
  const db = jsondb.load();
  const row = db.products.find((x) => x.id === id && x.tenant_id === req.user.tenantId);
  if (!row) return res.status(404).json({ error: '未找到商品' });
  if (code && db.products.some((x) => x.tenant_id === req.user.tenantId && x.code === code && x.id !== id)) return res.status(409).json({ error: '商品编码已存在' });
  Object.assign(row, { code, name, default_tax_rate: Number(default_tax_rate) === 8 ? 8 : 10, default_unit_price: Number(default_unit_price || 0), note, updated_at: now() });
  addLog(db, req.user.tenantId, req.user.userId, 'product.update', name);
  jsondb.save(db);
  res.json({ ok: true });
});

app.post('/api/products/import', auth, (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'データが空です' });
  const db = jsondb.load();
  let created = 0, skipped = 0;
  const results = rows.map((r) => {
    const code = String(r.code || '').trim();
    const name = String(r.name || '').trim();
    if (!name) return { code, name, status: 'error', reason: '商品名必填' };
    if (code && db.products.some((x) => x.tenant_id === req.user.tenantId && x.code === code)) { skipped++; return { code, name, status: 'skipped' }; }
    db.products.push({ id: jsondb.nextId(db, 'products'), tenant_id: req.user.tenantId, code, name, default_tax_rate: Number(r.tax_rate) === 8 ? 8 : 10, default_unit_price: Number(r.price || 0), note: r.note || '', created_at: now(), updated_at: now() });
    created++;
    return { code, name, status: 'created' };
  });
  addLog(db, req.user.tenantId, req.user.userId, 'product.import', `created:${created} skipped:${skipped}`);
  jsondb.save(db);
  res.json({ created, skipped, results });
});

app.delete('/api/products/:id', auth, (req, res) => {
  const db = jsondb.load();
  const row = db.products.find((x) => x.id === Number(req.params.id) && x.tenant_id === req.user.tenantId);
  db.products = db.products.filter((x) => !(x.id === Number(req.params.id) && x.tenant_id === req.user.tenantId));
  addLog(db, req.user.tenantId, req.user.userId, 'product.delete', row?.name || String(req.params.id));
  jsondb.save(db);
  res.json({ ok: true });
});

function listDocs(table, req, res) {
  const { status = '', from = '', to = '', q = '' } = req.query;
  const db = jsondb.load();
  let rows = db[table].filter((x) => x.tenant_id === req.user.tenantId);
  if (status) rows = rows.filter((x) => x.status === status);
  if (from) rows = rows.filter((x) => x.doc_date >= from);
  if (to) rows = rows.filter((x) => x.doc_date <= to);
  if (q) rows = rows.filter((x) => x.doc_no.includes(q) || x.customer_name.includes(q));
  rows.sort((a, b) => (a.doc_date < b.doc_date ? 1 : -1));
  res.json(rows);
}

function getDoc(table, itemTable, req, res) {
  const db = jsondb.load();
  const id = Number(req.params.id);
  const r = db[table].find((x) => x.id === id && x.tenant_id === req.user.tenantId);
  if (!r) return res.status(404).json({ error: '未找到单据' });
  const items = db[itemTable].filter((x) => x.doc_id === id);
  res.json({ ...r, items });
}

function createDoc(kind, table, itemTable, req, res) {
  const { doc_no, customer_name, doc_date, memo = '', rounding = 'round', items = [] } = req.body || {};
  if (!doc_no || !customer_name || !doc_date) return res.status(400).json({ error: '编号/客户名/日期必填' });
  const db = jsondb.load();
  const exists = db[table].find((x) => x.tenant_id === req.user.tenantId && x.doc_no === doc_no);
  if (exists) return res.status(409).json({ error: '该请求书编码已存在，禁止重复保存' });
  const c = computeItems(items, rounding);
  const id = jsondb.nextId(db, table);
  db[table].push({ id, tenant_id: req.user.tenantId, doc_no, customer_name, doc_date, status: 'saved', sent_at: '', sent_by: null, saved_at: now(), saved_by: req.user.userId, memo, subtotal: c.subtotal, tax_8: c.tax_8, tax_10: c.tax_10, total: c.total, created_at: now(), updated_at: now() });
  c.items.forEach((r) => db[itemTable].push({ id: jsondb.nextId(db, itemTable), doc_id: id, ...r }));
  addLog(db, req.user.tenantId, req.user.userId, `${kind}.create`, doc_no);
  jsondb.save(db);
  res.json({ id });
}

function updateDoc(kind, table, itemTable, req, res) {
  const id = Number(req.params.id);
  const { doc_no, customer_name, doc_date, memo = '', rounding = 'round', items = [] } = req.body || {};
  const db = jsondb.load();
  const row = db[table].find((x) => x.id === id && x.tenant_id === req.user.tenantId);
  if (!row) return res.status(404).json({ error: '未找到单据' });
  const dup = db[table].find((x) => x.tenant_id === req.user.tenantId && x.doc_no === doc_no && x.id !== id);
  if (dup) return res.status(409).json({ error: '该请求书编码已存在' });
  const c = computeItems(items, rounding);
  Object.assign(row, { doc_no, customer_name, doc_date, memo, subtotal: c.subtotal, tax_8: c.tax_8, tax_10: c.tax_10, total: c.total, updated_at: now() });
  db[itemTable] = db[itemTable].filter((x) => x.doc_id !== id);
  c.items.forEach((r) => db[itemTable].push({ id: jsondb.nextId(db, itemTable), doc_id: id, ...r }));
  addLog(db, req.user.tenantId, req.user.userId, `${kind}.update`, doc_no);
  jsondb.save(db);
  res.json({ ok: true });
}

function sendDoc(kind, table, req, res) {
  const id = Number(req.params.id);
  const db = jsondb.load();
  const row = db[table].find((x) => x.id === id && x.tenant_id === req.user.tenantId);
  if (!row) return res.status(404).json({ error: '未找到单据' });
  row.status = 'sent'; row.sent_at = now(); row.sent_by = req.user.userId; row.updated_at = now();
  addLog(db, req.user.tenantId, req.user.userId, `${kind}.send`, row.doc_no);
  jsondb.save(db);
  res.json({ ok: true });
}

app.get('/api/receipts', auth, (req, res) => listDocs('receipts', req, res));
app.get('/api/receipts/:id', auth, (req, res) => getDoc('receipts', 'receipt_items', req, res));
app.post('/api/receipts', auth, (req, res) => createDoc('receipt', 'receipts', 'receipt_items', req, res));
app.put('/api/receipts/:id', auth, (req, res) => updateDoc('receipt', 'receipts', 'receipt_items', req, res));
app.post('/api/receipts/:id/send', auth, (req, res) => sendDoc('receipt', 'receipts', req, res));

app.get('/api/requests', auth, (req, res) => listDocs('requests', req, res));
app.get('/api/requests/:id', auth, (req, res) => getDoc('requests', 'request_items', req, res));
app.post('/api/requests', auth, (req, res) => createDoc('request', 'requests', 'request_items', req, res));
app.put('/api/requests/:id', auth, (req, res) => updateDoc('request', 'requests', 'request_items', req, res));
app.post('/api/requests/:id/send', auth, (req, res) => sendDoc('request', 'requests', req, res));

app.get('/api/stock/summary', auth, (req, res) => {
  const db = jsondb.load();
  const products = db.products.filter((x) => x.tenant_id === req.user.tenantId).sort((a, b) => b.id - a.id);
  const result = products.map((p) => {
    const inQty = db.stock_in.filter((x) => x.tenant_id === req.user.tenantId && x.product_id === p.id).reduce((s, x) => s + x.qty, 0);
    const outQty = db.stock_out.filter((x) => x.tenant_id === req.user.tenantId && x.product_id === p.id).reduce((s, x) => s + x.qty, 0);
    return { ...p, stock: inQty - outQty };
  });
  res.json(result);
});

app.get('/api/stock/in', auth, (req, res) => {
  const db = jsondb.load();
  let rows = db.stock_in.filter((x) => x.tenant_id === req.user.tenantId);
  if (req.query.product_id) rows = rows.filter((x) => x.product_id === Number(req.query.product_id));
  res.json(rows.sort((a, b) => b.id - a.id).slice(0, 200));
});

app.post('/api/stock/in', auth, upload.single('receipt_file'), (req, res) => {
  const { product_id, qty, unit_cost, supplier, note, type } = req.body || {};
  if (!product_id || !qty) return res.status(400).json({ error: '商品と数量は必須です' });
  const db = jsondb.load();
  const product = db.products.find((x) => x.id === Number(product_id) && x.tenant_id === req.user.tenantId);
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });
  const receipt_file = req.file ? `/uploads/${path.basename(req.file.path)}` : '';
  db.stock_in.push({ id: jsondb.nextId(db, 'stock_in'), tenant_id: req.user.tenantId, product_id: Number(product_id), qty: Number(qty), unit_cost: Number(unit_cost || 0), supplier: supplier || '', note: note || '', type: type || 'normal', receipt_file, created_at: now(), created_by: req.user.userId });
  addLog(db, req.user.tenantId, req.user.userId, 'stock.in', `${product.name} x${qty}`);
  jsondb.save(db);
  res.json({ ok: true });
});

app.get('/api/stock/out', auth, (req, res) => {
  const db = jsondb.load();
  let rows = db.stock_out.filter((x) => x.tenant_id === req.user.tenantId);
  if (req.query.product_id) rows = rows.filter((x) => x.product_id === Number(req.query.product_id));
  res.json(rows.sort((a, b) => b.id - a.id).slice(0, 200));
});

app.post('/api/stock/out', auth, (req, res) => {
  const { product_id, qty, request_id, note } = req.body || {};
  if (!product_id || !qty) return res.status(400).json({ error: '商品と数量は必須です' });
  const db = jsondb.load();
  const product = db.products.find((x) => x.id === Number(product_id) && x.tenant_id === req.user.tenantId);
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });
  db.stock_out.push({ id: jsondb.nextId(db, 'stock_out'), tenant_id: req.user.tenantId, product_id: Number(product_id), qty: Number(qty), request_id: request_id ? Number(request_id) : null, note: note || '', created_at: now(), created_by: req.user.userId });
  addLog(db, req.user.tenantId, req.user.userId, 'stock.out', `${product.name} x${qty}`);
  jsondb.save(db);
  res.json({ ok: true });
});

app.get('/api/deliveries', auth, (req, res) => listDocs('deliveries', req, res));
app.get('/api/deliveries/:id', auth, (req, res) => getDoc('deliveries', 'delivery_items', req, res));
app.post('/api/deliveries', auth, (req, res) => createDoc('delivery', 'deliveries', 'delivery_items', req, res));
app.put('/api/deliveries/:id', auth, (req, res) => updateDoc('delivery', 'deliveries', 'delivery_items', req, res));
app.post('/api/deliveries/:id/send', auth, (req, res) => sendDoc('delivery', 'deliveries', req, res));

app.get('/api/ledger/summary', auth, (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const db = jsondb.load();
  const rows = db.receipts.filter((x) => x.tenant_id === req.user.tenantId && x.status === 'sent' && String(x.doc_date).startsWith(String(year)));
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
  rows.forEach((r) => { const m = Number(String(r.doc_date).slice(5, 7)); if (m >= 1 && m <= 12) months[m - 1].total += Number(r.total || 0); });
  res.json({ year, months, year_total: months.reduce((s, x) => s + x.total, 0) });
});

app.get('/api/audit-logs', auth, (req, res) => {
  const db = jsondb.load();
  const rows = db.audit_logs.filter((x) => x.tenant_id === req.user.tenantId).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 500);
  res.json(rows);
});

app.listen(PORT, () => console.log(`SaaS MVP running: http://localhost:${PORT}`));

