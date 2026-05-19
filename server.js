import http from 'node:http';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);
const secret = process.env.APP_SECRET || 'dev-secret-change-me';
const store = await createStore();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function getAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return verify(token);
}

function requireAuth(req, res) {
  const user = getAuth(req);
  if (!user) {
    sendJson(res, 401, { error: 'Please log in to continue.' });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'Admin') {
    sendJson(res, 403, { error: 'Admin access required.' });
    return null;
  }
  return user;
}

function cleanProduct(input) {
  const price = Number(input.price);
  const stock = Number(input.stock);
  if (!input.name || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
    return null;
  }
  return {
    name: String(input.name).trim(),
    category: String(input.category || 'General').trim(),
    description: String(input.description || '').trim(),
    image: String(input.image || '').trim(),
    price,
    stock
  };
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(req);
    const user = await store.findUserByEmail(String(body.email || '').toLowerCase());
    if (!user || user.passwordHash !== hashPassword(String(body.password || ''))) {
      return sendJson(res, 401, { error: 'Invalid email or password.' });
    }
    const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    return sendJson(res, 200, { token: sign(safeUser), user: safeUser });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = requireAuth(req, res);
    return user && sendJson(res, 200, { user });
  }

  if (req.method === 'GET' && url.pathname === '/api/products') {
    return sendJson(res, 200, { products: await store.listProducts() });
  }

  if (req.method === 'POST' && url.pathname === '/api/products') {
    if (!requireAdmin(req, res)) return;
    const product = cleanProduct(await readJson(req));
    if (!product) return sendJson(res, 400, { error: 'Name, valid price, and valid stock are required.' });
    return sendJson(res, 201, { product: await store.createProduct({ id: randomUUID(), ...product }) });
  }

  const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && req.method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    const product = cleanProduct(await readJson(req));
    if (!product) return sendJson(res, 400, { error: 'Name, valid price, and valid stock are required.' });
    const updated = await store.updateProduct(productMatch[1], product);
    return updated ? sendJson(res, 200, { product: updated }) : sendJson(res, 404, { error: 'Product not found.' });
  }

  if (productMatch && req.method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const deleted = await store.deleteProduct(productMatch[1]);
    return sendJson(res, deleted ? 204 : 404, deleted ? null : { error: 'Product not found.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    const user = requireAuth(req, res);
    if (!user) return;
    return sendJson(res, 200, { orders: await store.listOrders(user) });
  }

  if (req.method === 'POST' && url.pathname === '/api/orders') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readJson(req);
    const items = Array.isArray(body.items) ? body.items : [];
    const order = await store.createOrder({
      id: randomUUID(),
      userId: user.id,
      customerName: user.name,
      items,
      address: String(body.address || '').trim()
    });
    return order.error ? sendJson(res, 400, { error: order.error }) : sendJson(res, 201, { order });
  }

  const orderStatusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (orderStatusMatch && req.method === 'PATCH') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    const updated = await store.updateOrderStatus(orderStatusMatch[1], String(body.status || ''));
    return updated ? sendJson(res, 200, { order: updated }) : sendJson(res, 404, { error: 'Order not found.' });
  }

  sendJson(res, 404, { error: 'API route not found.' });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    const data = await readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Something went wrong on the server.' });
  }
});

server.listen(port, () => {
  console.log(`E-Commerce Web Application running at http://localhost:${port}`);
});
