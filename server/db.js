import fs from 'fs';
import path from 'path';

const dataDir = path.resolve('saas/data');
fs.mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'db.json');

const initial = {
  seq: { users: 0, tenants: 0, memberships: 0, products: 0, receipts: 0, receipt_items: 0, requests: 0, request_items: 0, deliveries: 0, delivery_items: 0, stock_in: 0, stock_out: 0, audit_logs: 0 },
  users: [],
  tenants: [],
  memberships: [],
  company_profiles: [],
  products: [],
  receipts: [],
  receipt_items: [],
  requests: [],
  request_items: [],
  deliveries: [],
  delivery_items: [],
  stock_in: [],
  stock_out: [],
  audit_logs: [],
};

function ensureSchema(db) {
  db.seq ||= {};
  ['users','tenants','memberships','products','receipts','receipt_items','requests','request_items','deliveries','delivery_items','stock_in','stock_out','audit_logs'].forEach((k) => {
    if (typeof db.seq[k] !== 'number') db.seq[k] = 0;
    if (!Array.isArray(db[k])) db[k] = [];
  });
  if (!Array.isArray(db.company_profiles)) db.company_profiles = [];
  return db;
}

function load() {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(initial, null, 2), 'utf8');
    return structuredClone(initial);
  }
  return ensureSchema(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function save(db) {
  fs.writeFileSync(file, JSON.stringify(ensureSchema(db), null, 2), 'utf8');
}

function nextId(db, table) {
  db.seq[table] = (db.seq[table] || 0) + 1;
  return db.seq[table];
}

export const jsondb = { load, save, nextId };
