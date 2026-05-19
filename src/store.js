import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(__dirname, '..', 'data', 'store.json');
const statuses = ['Placed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

function seedData() {
  return {
    users: [
      {
        id: 'admin-1',
        name: 'Store Admin',
        email: 'admin@store.com',
        role: 'Admin',
        passwordHash: hashPassword('admin123')
      },
      {
        id: 'user-1',
        name: 'Demo User',
        email: 'user@store.com',
        role: 'User',
        passwordHash: hashPassword('user123')
      }
    ],
    products: [
      {
        id: 'prod-1',
        name: 'Wireless Headphones',
        category: 'Audio',
        description: 'Comfortable over-ear headphones with clear sound and long battery life.',
        price: 79.99,
        stock: 18,
        image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80'
      },
      {
        id: 'prod-2',
        name: 'Smart Watch',
        category: 'Wearables',
        description: 'Track workouts, notifications, and daily goals from your wrist.',
        price: 129.99,
        stock: 12,
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80'
      },
      {
        id: 'prod-3',
        name: 'Travel Backpack',
        category: 'Bags',
        description: 'Durable daily backpack with laptop storage and quick-access pockets.',
        price: 59.5,
        stock: 24,
        image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80'
      }
    ],
    orders: []
  };
}

class JsonStore {
  constructor() {
    this.data = null;
  }

  async init() {
    await mkdir(path.dirname(dataFile), { recursive: true });
    try {
      this.data = JSON.parse(await readFile(dataFile, 'utf8'));
    } catch {
      this.data = seedData();
      await this.save();
    }
  }

  async save() {
    await writeFile(dataFile, JSON.stringify(this.data, null, 2));
  }

  async findUserByEmail(email) {
    return this.data.users.find((user) => user.email === email);
  }

  async listProducts() {
    return [...this.data.products].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createProduct(product) {
    this.data.products.push(product);
    await this.save();
    return product;
  }

  async updateProduct(id, patch) {
    const index = this.data.products.findIndex((product) => product.id === id);
    if (index < 0) return null;
    this.data.products[index] = { ...this.data.products[index], ...patch };
    await this.save();
    return this.data.products[index];
  }

  async deleteProduct(id) {
    const count = this.data.products.length;
    this.data.products = this.data.products.filter((product) => product.id !== id);
    await this.save();
    return this.data.products.length !== count;
  }

  async listOrders(user) {
    const orders = user.role === 'Admin' ? this.data.orders : this.data.orders.filter((order) => order.userId === user.id);
    return [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async createOrder(input) {
    if (!input.address) return { error: 'Delivery address is required.' };
    if (!input.items.length) return { error: 'Your cart is empty.' };

    const orderItems = [];
    let total = 0;
    for (const item of input.items) {
      const product = this.data.products.find((candidate) => candidate.id === item.productId);
      const quantity = Number(item.quantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1) return { error: 'Invalid cart item.' };
      if (product.stock < quantity) return { error: `${product.name} has only ${product.stock} left in stock.` };
      orderItems.push({ productId: product.id, name: product.name, price: product.price, quantity });
      total += product.price * quantity;
    }

    for (const item of orderItems) {
      const product = this.data.products.find((candidate) => candidate.id === item.productId);
      product.stock -= item.quantity;
    }

    const order = {
      id: input.id,
      userId: input.userId,
      customerName: input.customerName,
      items: orderItems,
      address: input.address,
      total: Number(total.toFixed(2)),
      status: 'Placed',
      createdAt: new Date().toISOString()
    };
    this.data.orders.push(order);
    await this.save();
    return order;
  }

  async updateOrderStatus(id, status) {
    if (!statuses.includes(status)) return null;
    const order = this.data.orders.find((candidate) => candidate.id === id);
    if (!order) return null;
    order.status = status;
    await this.save();
    return order;
  }
}

class MongoStore {
  async init() {
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
    await this.client.connect();
    this.db = this.client.db(process.env.MONGODB_DB || 'ecommerce_store');
    this.users = this.db.collection('users');
    this.products = this.db.collection('products');
    this.orders = this.db.collection('orders');
    if ((await this.users.countDocuments()) === 0) {
      const seed = seedData();
      await this.users.insertMany(seed.users);
      await this.products.insertMany(seed.products);
    }
  }

  async findUserByEmail(email) {
    return this.users.findOne({ email });
  }

  async listProducts() {
    return this.products.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
  }

  async createProduct(product) {
    await this.products.insertOne(product);
    return product;
  }

  async updateProduct(id, patch) {
    await this.products.updateOne({ id }, { $set: patch });
    return this.products.findOne({ id }, { projection: { _id: 0 } });
  }

  async deleteProduct(id) {
    const result = await this.products.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async listOrders(user) {
    const query = user.role === 'Admin' ? {} : { userId: user.id };
    return this.orders.find(query, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  }

  async createOrder(input) {
    if (!input.address) return { error: 'Delivery address is required.' };
    if (!input.items.length) return { error: 'Your cart is empty.' };

    const orderItems = [];
    let total = 0;
    for (const item of input.items) {
      const quantity = Number(item.quantity);
      const product = await this.products.findOne({ id: item.productId });
      if (!product || !Number.isInteger(quantity) || quantity < 1) return { error: 'Invalid cart item.' };
      if (product.stock < quantity) return { error: `${product.name} has only ${product.stock} left in stock.` };
      orderItems.push({ productId: product.id, name: product.name, price: product.price, quantity });
      total += product.price * quantity;
    }

    for (const item of orderItems) {
      await this.products.updateOne({ id: item.productId }, { $inc: { stock: -item.quantity } });
    }

    const order = {
      id: input.id,
      userId: input.userId,
      customerName: input.customerName,
      items: orderItems,
      address: input.address,
      total: Number(total.toFixed(2)),
      status: 'Placed',
      createdAt: new Date().toISOString()
    };
    await this.orders.insertOne(order);
    return order;
  }

  async updateOrderStatus(id, status) {
    if (!statuses.includes(status)) return null;
    await this.orders.updateOne({ id }, { $set: { status } });
    return this.orders.findOne({ id }, { projection: { _id: 0 } });
  }
}

export async function createStore() {
  const store = process.env.ECOM_DB === 'mongodb' ? new MongoStore() : new JsonStore();
  await store.init();
  return store;
}
