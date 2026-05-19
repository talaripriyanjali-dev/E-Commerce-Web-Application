const state = {
  user: JSON.parse(localStorage.getItem('storeUser') || 'null'),
  token: localStorage.getItem('storeToken') || '',
  products: [],
  cart: JSON.parse(localStorage.getItem('storeCart') || '[]'),
  orders: [],
  view: 'shop'
};

const $ = (selector) => document.querySelector(selector);
const money = (value) => `$${Number(value).toFixed(2)}`;

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add('hidden'), 2800);
}

function saveSession(payload) {
  state.user = payload.user;
  state.token = payload.token;
  localStorage.setItem('storeUser', JSON.stringify(state.user));
  localStorage.setItem('storeToken', state.token);
}

function logout() {
  state.user = null;
  state.token = '';
  localStorage.removeItem('storeUser');
  localStorage.removeItem('storeToken');
  renderAuth();
  showView('shop');
}

function saveCart() {
  localStorage.setItem('storeCart', JSON.stringify(state.cart));
}

function renderAuth() {
  const isAdmin = state.user?.role === 'Admin';
  $('#userBadge').textContent = state.user ? `${state.user.name} (${state.user.role})` : 'Guest';
  $('#loginToggle').textContent = state.user ? 'Logout' : 'Login';
  document.querySelectorAll('.admin-only').forEach((node) => node.classList.toggle('hidden', !isAdmin));
  if (!isAdmin && state.view === 'admin') showView('shop');
}

function showView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((node) => node.classList.add('hidden'));
  $(`#${view}View`).classList.remove('hidden');
  document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
  if (view === 'orders') loadOrders();
  if (view === 'admin') renderAdmin();
}

function filteredProducts() {
  const query = $('#searchInput').value.trim().toLowerCase();
  if (!query) return state.products;
  return state.products.filter((product) =>
    [product.name, product.category, product.description].join(' ').toLowerCase().includes(query)
  );
}

function renderProducts() {
  $('#productGrid').innerHTML = filteredProducts()
    .map((product) => {
      const disabled = product.stock < 1 ? 'disabled' : '';
      return `
        <article class="card product-card">
          <img src="${product.image || '/placeholder.svg'}" alt="${product.name}">
          <div class="product-body">
            <p class="product-meta">${product.category}</p>
            <h3>${product.name}</h3>
            <p>${product.description}</p>
            <div class="price-row item-actions">
              <span class="price">${money(product.price)}</span>
              <span class="stock">${product.stock} left</span>
            </div>
            <button ${disabled} data-add="${product.id}">${product.stock ? 'Add to Cart' : 'Out of Stock'}</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);
  const current = state.cart.find((item) => item.productId === productId);
  const quantity = current ? current.quantity + 1 : 1;
  if (quantity > product.stock) return toast('No more stock available for that product.');
  if (current) current.quantity = quantity;
  else state.cart.push({ productId, quantity });
  saveCart();
  renderCart();
}

function updateQuantity(productId, delta) {
  const item = state.cart.find((candidate) => candidate.productId === productId);
  if (!item) return;
  const product = state.products.find((candidate) => candidate.id === productId);
  item.quantity += delta;
  if (item.quantity < 1) state.cart = state.cart.filter((candidate) => candidate.productId !== productId);
  if (product && item.quantity > product.stock) item.quantity = product.stock;
  saveCart();
  renderCart();
}

function cartDetails() {
  return state.cart
    .map((item) => ({ ...item, product: state.products.find((product) => product.id === item.productId) }))
    .filter((item) => item.product);
}

function renderCart() {
  const items = cartDetails();
  const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  $('#cartCount').textContent = `${count} item${count === 1 ? '' : 's'}`;
  $('#cartTotal').textContent = money(total);
  $('#cartItems').innerHTML = items.length
    ? items
        .map(
          (item) => `
          <div class="cart-item">
            <div>
              <strong>${item.product.name}</strong>
              <div class="muted">${money(item.product.price)} each</div>
            </div>
            <div class="qty">
              <button data-qty="${item.productId}" data-delta="-1">-</button>
              <span>${item.quantity}</span>
              <button data-qty="${item.productId}" data-delta="1">+</button>
            </div>
          </div>
        `
        )
        .join('')
    : '<p class="muted">Your cart is empty.</p>';
}

async function loadProducts() {
  const data = await api('/api/products');
  state.products = data.products;
  renderProducts();
  renderCart();
  renderAdmin();
}

async function loadOrders() {
  if (!state.user) {
    $('#ordersList').innerHTML = '<p class="muted">Please log in to see order tracking.</p>';
    return;
  }
  const data = await api('/api/orders');
  state.orders = data.orders;
  renderOrders();
}

function renderOrders() {
  $('#ordersList').innerHTML = state.orders.length
    ? state.orders
        .map(
          (order) => `
          <article class="order-card">
            <div class="row-head">
              <div>
                <h3>Order ${order.id.slice(0, 8)}</h3>
                <div class="muted">${order.customerName} · ${new Date(order.createdAt).toLocaleString()}</div>
              </div>
              <span class="status">${order.status}</span>
            </div>
            <div>${order.items
              .map((item) => `<div class="order-line"><span>${item.name} x ${item.quantity}</span><strong>${money(item.price * item.quantity)}</strong></div>`)
              .join('')}</div>
            <div class="total-row"><span>${order.address}</span><strong>${money(order.total)}</strong></div>
            ${
              state.user?.role === 'Admin'
                ? `<select data-status="${order.id}">
                    ${['Placed', 'Processing', 'Shipped', 'Delivered', 'Cancelled']
                      .map((status) => `<option ${status === order.status ? 'selected' : ''}>${status}</option>`)
                      .join('')}
                  </select>`
                : ''
            }
          </article>
        `
        )
        .join('')
    : '<p class="muted">No orders yet.</p>';
}

function fillProductForm(product = {}) {
  $('#productId').value = product.id || '';
  $('#productName').value = product.name || '';
  $('#productCategory').value = product.category || '';
  $('#productPrice').value = product.price ?? '';
  $('#productStock').value = product.stock ?? '';
  $('#productImage').value = product.image || '';
  $('#productDescription').value = product.description || '';
}

function renderAdmin() {
  if (state.user?.role !== 'Admin') return;
  $('#adminProducts').innerHTML = state.products
    .map(
      (product) => `
      <article class="admin-row">
        <div class="row-head">
          <div>
            <h3>${product.name}</h3>
            <div class="muted">${product.category} · ${money(product.price)} · ${product.stock} in stock</div>
          </div>
          <div class="item-actions">
            <button class="ghost" data-edit="${product.id}">Edit</button>
            <button class="danger" data-delete="${product.id}">Delete</button>
          </div>
        </div>
        <p>${product.description}</p>
      </article>
    `
    )
    .join('');
}

async function checkout(event) {
  event.preventDefault();
  if (!state.user) return toast('Please log in before checkout.');
  const address = $('#address').value.trim();
  const items = state.cart.map(({ productId, quantity }) => ({ productId, quantity }));
  const data = await api('/api/orders', { method: 'POST', body: JSON.stringify({ address, items }) });
  state.cart = [];
  saveCart();
  $('#address').value = '';
  toast(`Order ${data.order.id.slice(0, 8)} placed.`);
  await loadProducts();
  showView('orders');
}

async function saveProduct(event) {
  event.preventDefault();
  const id = $('#productId').value;
  const payload = {
    name: $('#productName').value,
    category: $('#productCategory').value,
    price: Number($('#productPrice').value),
    stock: Number($('#productStock').value),
    image: $('#productImage').value,
    description: $('#productDescription').value
  };
  await api(id ? `/api/products/${id}` : '/api/products', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload)
  });
  fillProductForm();
  await loadProducts();
  toast(id ? 'Product updated.' : 'Product created.');
}

document.addEventListener('click', async (event) => {
  const addId = event.target.dataset.add;
  const qtyId = event.target.dataset.qty;
  const view = event.target.dataset.view;
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;

  if (addId) addToCart(addId);
  if (qtyId) updateQuantity(qtyId, Number(event.target.dataset.delta));
  if (view) showView(view);
  if (editId) fillProductForm(state.products.find((product) => product.id === editId));
  if (deleteId && confirm('Delete this product?')) {
    await api(`/api/products/${deleteId}`, { method: 'DELETE' });
    await loadProducts();
    toast('Product deleted.');
  }
});

$('#loginToggle').addEventListener('click', () => {
  if (state.user) return logout();
  $('#loginPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: $('#email').value, password: $('#password').value })
  });
  saveSession(data);
  renderAuth();
  toast(`Welcome, ${data.user.name}.`);
});

$('#useAdmin').addEventListener('click', () => {
  $('#email').value = 'admin@store.com';
  $('#password').value = 'admin123';
});

$('#checkoutForm').addEventListener('submit', (event) => checkout(event).catch((error) => toast(error.message)));
$('#productForm').addEventListener('submit', (event) => saveProduct(event).catch((error) => toast(error.message)));
$('#clearProduct').addEventListener('click', () => fillProductForm());
$('#searchInput').addEventListener('input', renderProducts);
$('#refreshOrders').addEventListener('click', () => loadOrders().catch((error) => toast(error.message)));

document.addEventListener('change', async (event) => {
  const orderId = event.target.dataset.status;
  if (!orderId) return;
  await api(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: event.target.value })
  });
  await loadOrders();
  toast('Order status updated.');
});

window.addEventListener('unhandledrejection', (event) => toast(event.reason.message || 'Something went wrong.'));

renderAuth();
loadProducts().catch((error) => toast(error.message));
