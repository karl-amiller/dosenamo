
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const peso = n => '₱' + Math.round(n).toLocaleString('en-PH');

let tm;

function toast(m) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(tm);
  tm = setTimeout(() => t.classList.remove('show'), 2400);
}

function go(t) {
  $$('section').forEach(s => s.classList.toggle('on', s.id === t));
  $$('#nav button').forEach(b =>
    b.setAttribute('aria-selected', b.dataset.t === t)
  );
  window.scrollTo(0, 0);
}

function bindGo(root = document) {
  root.querySelectorAll('[data-go]').forEach(b => {
    b.onclick = () => go(b.dataset.go);
  });
}

$$('#nav button').forEach(b => {
  b.onclick = () => go(b.dataset.t);
});

function chips(sel, items, cur, cb) {
  const el = $(sel);
  if (!el) return;

  const draw = () => {
    el.innerHTML = items.map(i =>
      `<button class="chip" aria-pressed="${i === cur}">${i}</button>`
    ).join('');

    el.querySelectorAll('.chip').forEach((b, n) => {
      b.onclick = () => {
        cur = items[n];
        draw();
        cb(cur);
      };
    });
  };

  draw();
}

/* ---------- Data ---------- */

const VARS = [];

const SIZES = [
  ['Peewee', '35–39 g', -25, 37],
  ['Small', '40–49 g', -12, 45],
  ['Medium', '50–59 g', 0, 55],
  ['Large', '60–64 g', 15, 62],
  ['Extra large', '65–69 g', 30, 67],
  ['Jumbo', '70 g and up', 45, 74]
];

const NUTRI = [
  ['Chicken, medium', 70, '6 g', '5 g', '70 mg'],
  ['Free-range chicken', 72, '6.3 g', '5 g', '70 mg'],
  ['Duck', 130, '9 g', '10 g', '100 mg'],
  ['Salted duck', 120, '8 g', '9 g', '~480 mg'],
  ['Quail', 14, '1.2 g', '1 g', '13 mg']
];

const RECIPES = [
  ['Tortang talong', '2 eggs · 25 min', 4.8, 'Standard'],
  ['Leche flan', '10 yolks · 90 min', 4.9, 'Standard'],
  ['Ensaladang itlog na maalat', '3 salted eggs · 10 min', 4.6, 'Salted duck']
];

const FARMS = [];
let selectedRating = 0;
let selectedReviewBatch = '';
let selectedZone = 'District A';
let zoneSchedules = [];
let deliveryFee = null;
let selectedSupplierId = null;
let subscriptionBeingEdited = null;
let productsLoaded = false;
let apiProducts = [];

/* ---------- Home ---------- */

if ($('#tray')) {
  $('#tray').innerHTML = Array.from({ length: 30 }, (_, i) =>
    `<div class="cup">${i < 9 ? '<div class="egg"></div>' : ''}</div>`
  ).join('');
}

if ($('#report')) {
  $('#report').onclick = () => {
    $('#breakageForm').hidden = !$('#breakageForm').hidden;
  };
}

const rate = $('#rate');

if (rate) {
  rate.innerHTML = [1, 2, 3, 4, 5].map(n =>
    `<button aria-label="${n} stars">★</button>`
  ).join('');

  rate.querySelectorAll('button').forEach((b, i) => {
    b.onclick = () => {
      selectedRating = i + 1;
      rate.querySelectorAll('button').forEach((x, j) =>
        x.classList.toggle('on', j <= i)
      );
    };
  });
}

/* ---------- Subscribe ---------- */

const S = {
  v: null,
  size: SIZES[2],
  q: 2,
  freq: 'Weekly',
  day: 'Tue',
  win: '6–8 AM',
  zone: selectedZone
};

function normalizeProductValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findProductByText(value) {
  const target = normalizeProductValue(value);
  if (!target) return VARS[0] || null;

  return VARS.find(v => {
    const candidates = [
      v && v.n,
      v && v.id,
      v && v.egg_type,
      v && v.size_name,
      v && `${v.n} ${v.egg_type}`,
      v && `${v.n} ${v.size_name}`
    ];

    return candidates.some(candidate => {
      const normalized = normalizeProductValue(candidate);
      return normalized === target || normalized.includes(target) || target.includes(normalized);
    });
  }) || VARS[0] || null;
}

function drawVar() {
  if (!$('#variety')) return;

  if (!VARS.length) {
    $('#variety').innerHTML = '<small class="mute">Loading products from the catalog…</small>';
    return;
  }

  $('#variety').innerHTML = VARS.map(v =>
    `<button class="opt" aria-pressed="${v === S.v}" data-id="${v.id}">
      <b>${escapeHtml(v.n)}</b>
      <small>${peso(v.p)} / ${escapeHtml(v.u)}${v.size_name && v.size_name !== 'not_applicable' ? ` · ${escapeHtml(titleCase(v.size_name))}` : ''}</small>
    </button>`
  ).join('');

  $$('#variety .opt').forEach(b => {
    b.onclick = () => {
      S.v = findProductByText(b.dataset.id);
      drawVar();
      calc();
    };
  });
}

function drawSizes() {
  if (!$('#sizes')) return;

  $('#sizes').innerHTML = SIZES.map(s =>
    `<button class="chip" aria-pressed="${s === S.size}">${s[0]} · ${s[1]}</button>`
  ).join('');

  $$('#sizes .chip').forEach((b, i) => {
    b.onclick = () => {
      S.size = SIZES[i];
      drawSizes();
      calc();
    };
  });
}

function calc() {
  if (!$('#sub') || !S.v) return;

  const hasSz = !S.v.product_id && !!S.v.sz;
  const unit = Number(S.v.p);
  const sub = unit * S.q;
  const packageCount = Number(S.v.units_per_tray || (S.v.u.match(/\d+/) || [30])[0]);
  const packageUnit = S.v.unit || (String(S.v.u).startsWith('bottle') ? 'bottle' : 'tray');

  if ($('#sizeBox')) {
    $('#sizeBox').hidden = !hasSz;
  }

  $('#q').textContent = S.q;
  $('#unit').textContent = `${S.q > 1 ? `${packageUnit}s` : packageUnit} · ${packageCount} per pack`;

  $('#sum').textContent = `${S.q} × ${S.v.n}`;
  $('#sumsub').textContent =
    (S.v.size_name && S.v.size_name !== 'not_applicable'
      ? titleCase(S.v.size_name) + ' · '
      : hasSz ? S.size[0] + ' · ' : '') + peso(unit) + ` per ${packageUnit}`;

  $('#sub').textContent = peso(sub);
  $('#deliveryFee').textContent = Number.isFinite(deliveryFee) ? peso(deliveryFee) : '—';
  $('#tot').textContent = Number.isFinite(deliveryFee) ? peso(sub + deliveryFee) : '—';
  $('#routeSummary').textContent = `${S.zone} shared route · ${S.day}`;
  $('#when').textContent = `${S.freq}, ${S.zone} · ${S.day} · ${S.win}`;
  const start = $('#start');
  if (start) start.disabled = !productsLoaded || !zoneSchedules.length || !Number.isFinite(deliveryFee);
}

if ($('#minus')) {
  $('#minus').onclick = () => {
    S.q = Math.max(1, S.q - 1);
    calc();
  };
}

if ($('#plus')) {
  $('#plus').onclick = () => {
    S.q = Math.min(20, S.q + 1);
    calc();
  };
}

chips('#freq', ['Weekly', 'Every 2 weeks', 'Monthly'], S.freq, v => {
  S.freq = v;
  calc();
});

chips('#win', ['6–8 AM', '8–10 AM', '1–3 PM'], S.win, v => {
  S.win = v;
  calc();
});

drawVar();
drawSizes();
calc();

/* ---------- Guide ---------- */

if ($('#sizeTable')) {
  $('#sizeTable').innerHTML = SIZES.map(s =>
    `<div class="srow">
      <div class="vis">
        <i class="${s[0] === 'Medium' ? 'hl' : ''}"
          style="width:${s[3] * .6}px;height:${s[3] * .75}px"></i>
      </div>
      <div><b>${s[0]}</b><small>${s[1]}</small></div>
      <span class="mute">${s[2] >= 0 ? '+' : '−'}${peso(Math.abs(s[2]))} / tray</span>
    </div>`
  ).join('');
}

if ($('#nutri')) {
  $('#nutri').innerHTML =
    '<tr><th>Type</th><th>Calories</th><th>Protein</th><th>Fat</th><th>Cholesterol</th></tr>' +
    NUTRI.map(r =>
      `<tr><td>${r[0]}</td><td>${r[1]} kcal</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`
    ).join('');
}

if ($('#recipes')) {
  $('#recipes').innerHTML = RECIPES.map(r =>
    `<div class="card rc">
      <h3>${r[0]}</h3>
      <small>${r[1]}</small>
      <div class="row">
        <span><b style="color:#B88A00">★</b> ${r[2]}</span>
        <button class="btn alt" data-add="${r[3]}">Add ${r[3].toLowerCase()} eggs</button>
      </div>
    </div>`
  ).join('');
}

$$('[data-add]').forEach(b => {
  b.onclick = () => {
    S.v = findProductByText(b.dataset.add);
    drawVar();
    calc();
    go('subscribe');
    toast((S.v && S.v.n) || b.dataset.add + ' eggs selected');
  };
});

bindGo();

/* ---------- Trace ---------- */

/* ---------- Map ---------- */

let filt = 'All';
let sel = 0;

function drawMap() {
  if (!$('#mapbox') || !$('#farmList') || !$('#detail')) return;

  const list = FARMS.map((f, i) => ({ f, i }))
    .filter(o => filt === 'All' || o.f.t + 's' === filt);

  $$('#mapbox .pin').forEach(p => p.remove());
  if (!list.length) {
    $('#farmList').innerHTML = '<div class="card"><b>Loading local suppliers…</b><small>Farm and shop listings come from the partner directory.</small></div>';
    $('#detail').innerHTML = '<p class="mute">Supplier details will appear here.</p>';
    return;
  }

  $('#mapbox').insertAdjacentHTML(
    'beforeend',
    list.map(o =>
      `<button class="pin ${o.f.t === 'Shop' ? 'shop' : ''}"
        style="left:${o.f.x}%;top:${o.f.y}%"
        aria-pressed="${o.i === sel}" data-i="${o.i}">${o.f.n}</button>`
    ).join('')
  );

  $('#farmList').innerHTML = list.map(o =>
    `<button class="fi" aria-pressed="${o.i === sel}" data-i="${o.i}">
      <span><b>${escapeHtml(o.f.n)}</b><small>${escapeHtml(o.f.t)}${o.f.km == null ? '' : ` · ${escapeHtml(o.f.km)} km`}</small></span>
      <span>${Number(o.f.rv) ? `★ ${escapeHtml(o.f.r)} · ${Number(o.f.rv)}` : 'New partner'}</span>
    </button>`
  ).join('');

  $$('#mapbox .pin, #farmList .fi').forEach(b => {
    b.onclick = () => pick(+b.dataset.i);
  });

  const f = FARMS[sel];
  if (!f) return;

  const locationQuery = f.latitude != null && f.longitude != null
    ? `${f.latitude},${f.longitude}`
    : f.address || f.n;
  const directionUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent(locationQuery)}`;
  const selected = Number(selectedSupplierId) === Number(f.farm_id);
  $('#detail').innerHTML =
    `<span class="eyebrow">${escapeHtml(f.t === 'Shop' ? 'LOCAL SHOP' : 'PARTNER FARM')}</span>
      <h2>${escapeHtml(f.n)}</h2>
      <p class="mute">${escapeHtml(f.address || 'Address not listed')}</p>
      <div class="item"><span>Community rating</span><b>${Number(f.rv) ? `★ ${escapeHtml(f.r)} · ${Number(f.rv)} reviews` : 'Be the first to review'}</b></div>
      <div class="item"><span>Hours</span><b>${escapeHtml(f.h || 'Contact partner for hours')}</b></div>
      <div class="item"><span>Products</span><b>${escapeHtml(f.s || 'Egg products')}</b></div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="chooseSupplier" ${f.farm_id == null ? 'disabled' : ''}>${selected ? 'Selected for your plan' : 'Choose supplier'}</button>
        <button class="btn alt" id="dir">Directions</button>
      </div>`;

  loadFarmReviews(f.farm_id);
  $('#dir').onclick = () => window.open(directionUrl, '_blank', 'noopener,noreferrer');
  $('#chooseSupplier').onclick = () => {
    if (f.farm_id == null) return;
    selectedSupplierId = Number(f.farm_id);
    renderSubscriptionSupplier();
    calc();
    go('subscribe');
    toast(`${f.n} selected for your plan.`);
  };
}

async function loadFarmReviews(farmId) {
  const detail = $('#detail');
  if (!detail || farmId == null) return;
  detail.insertAdjacentHTML('beforeend', '<div id="farmReviews" class="community-reviews"><span class="eyebrow">FROM THE COMMUNITY</span><small class="mute">Loading recent reviews…</small></div>');
  try {
    const data = await apiRequest('farm_reviews', { params: { farm_id: farmId } });
    const reviews = Array.isArray(data.reviews) ? data.reviews : [];
    const container = $('#farmReviews');
    if (!container || Number(FARMS[sel]?.farm_id) !== Number(farmId)) return;
    container.innerHTML = `<span class="eyebrow">FROM THE COMMUNITY</span>` +
      (reviews.length
        ? reviews.map(review => `<blockquote><b>${'★'.repeat(Number(review.rating))}</b><small>${escapeHtml(review.review_text || 'No written note.')}</small></blockquote>`).join('')
        : '<small class="mute">No reviews yet. Be the first after a delivery.</small>');
  } catch (error) {
    console.error('Unable to load supplier reviews:', error);
    const container = $('#farmReviews');
    if (container) container.innerHTML = '<span class="eyebrow">FROM THE COMMUNITY</span><small class="mute">Recent reviews are unavailable.</small>';
  }
}

function pick(i) {
  if (i >= 0) sel = i;
  drawMap();
}

chips('#mapf', ['All', 'Farms', 'Shops'], filt, v => {
  filt = v;
  const first = FARMS.findIndex(f => v === 'All' || f.t + 's' === v);
  sel = first < 0 ? 0 : first;
  drawMap();
});

drawMap();

/* ---------- Business ---------- */

const B = { t: 12, wk: '2', win: '5–7 AM', productId: null };

function tier(t) {
  return t >= 30 ? [.12, '30+ trays: 12% off']
    : t >= 16 ? [.08, '16–29 trays: 8% off']
    : t >= 6 ? [.05, '6–15 trays: 5% off']
    : [0, 'Under 6 trays: standard price'];
}

function bcalc() {
  if (!$('#tv')) return;

  const product = apiProducts.find(item => Number(item.product_id) === Number(B.productId)) || apiProducts[0];
  if (!product) {
    $('#tier').textContent = 'Bulk pricing loads with the product catalog';
    $('#ppt').textContent = '—';
    $('#pd').textContent = '—';
    $('#pm').textContent = '—';
    $('#save').textContent = '—';
    return;
  }
  const [d, lbl] = tier(B.t);
  const basePrice = Number(product.price);
  const ppt = Math.round(basePrice * (1 - d) * 100) / 100;
  const pd = ppt * B.t + (B.t >= 6 ? 0 : 20);
  const pm = pd * (+B.wk) * 4.3;

  $('#tv').textContent = B.t;
  $('#tier').textContent = `${lbl}${product ? ` · ${product.product_name}` : ''}`;
  $('#ppt').textContent = peso(ppt);
  $('#pd').textContent = peso(pd);
  $('#pm').textContent = peso(pm);
  $('#save').textContent = `${Math.round(d * 100)}%`;
}

if ($('#trays')) {
  $('#trays').oninput = e => {
    B.t = +e.target.value;
    bcalc();
  };
}

chips('#perwk', ['1', '2', '3'], B.wk, v => {
  B.wk = v;
  bcalc();
});

chips('#bwin', ['5–7 AM', '7–9 AM', '1–3 PM'], B.win, v => {
  B.win = v;
  bcalc();
});

bcalc();

/* ---------- DOSENAMO MySQL API integration ---------- */

const API_URL = 'api/api.php';

let apiFarms = [];
let activeSubscriptionId = null;
let activeSubscriptionStatus = null;

async function apiRequest(action, options = {}) {
  const query = new URLSearchParams({ action });

  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      query.set(key, String(value));
    });
  }

  const response = await fetch(`${API_URL}?${query.toString()}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server returned an invalid response. Check PHP/server setup.');
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

function apiToastError(error) {
  console.error(error);
  toast(error.message || 'Could not connect to the database. Check the server setup.');
}

function mapApiProduct(p) {
  const name = (p.product_name || '').toLowerCase();
  let id = String(p.egg_type) === 'egg_whites' ? 'whites'
    : String(p.egg_type) === 'egg_yolks' ? 'yolks' : 'std';
  if (String(p.egg_type) === 'free_range' || name.includes('free') || name.includes('organic')) id = 'free';
  else if (name.includes('salted')) id = 'salt';
  else if (String(p.egg_type) === 'duck' || name.includes('duck')) id = 'duck';
  else if (String(p.egg_type) === 'quail' || name.includes('quail')) id = 'quail';

  return {
    id,
    n: p.product_name,
    p: Number(p.price),
    u: `${p.unit || 'tray'} of ${Number(p.units_per_tray || 30)}`,
    unit: p.unit || 'tray',
    units_per_tray: Number(p.units_per_tray || 30),
    product_id: Number(p.product_id),
    egg_type: p.egg_type,
    size_name: p.size_name,
    weight_min_g: p.weight_min_g,
    weight_max_g: p.weight_max_g,
    stock_quantity: Number(p.stock_quantity || 0)
  };
}

async function loadProductsFromDatabase() {
  const data = await apiRequest('products');
  apiProducts = data.products || [];

  if (!apiProducts.length) throw new Error('No sellable products are available.');

  VARS.splice(0, VARS.length, ...apiProducts.map(mapApiProduct));
  S.v = VARS[0];
  B.productId = Number(apiProducts[0].product_id);
  const businessProducts = $('#bizProduct');
  if (businessProducts) {
    businessProducts.innerHTML = apiProducts.map(product =>
      `<option value="${Number(product.product_id)}">${escapeHtml(product.product_name)} · ${peso(Number(product.price))}/${escapeHtml(product.unit)}</option>`
    ).join('');
    businessProducts.value = String(B.productId);
    businessProducts.onchange = () => {
      B.productId = Number(businessProducts.value);
      bcalc();
    };
  }
  productsLoaded = true;
  if ($('#quote')) $('#quote').disabled = false;
  drawVar();
  calc();
  bcalc();
}

async function loadFarmsFromDatabase() {
  const data = await apiRequest('farms');
  apiFarms = data.farms || [];

  if (!apiFarms.length) {
    $('#farmList').innerHTML = '<div class="card"><b>No local suppliers yet.</b><small>Partner listings will appear here when available.</small></div>';
    $('#detail').innerHTML = '<p class="mute">There are no active suppliers in your directory.</p>';
    return;
  }

  FARMS.splice(0, FARMS.length, ...apiFarms.map(f => ({
    farm_id: Number(f.farm_id),
    n: f.farm_name,
    t: f.partner_type === 'shop' ? 'Shop' : 'Farm',
    x: f.map_x == null ? 50 : Number(f.map_x),
    y: f.map_y == null ? 50 : Number(f.map_y),
    km: f.distance_km == null ? null : Number(f.distance_km),
    r: f.rating == null ? 0 : Number(f.rating),
    rv: f.review_count == null ? 0 : Number(f.review_count),
    h: f.opening_hours || 'Contact partner for hours',
    s: f.products_summary || 'Egg products',
    address: f.address,
    latitude: f.latitude,
    longitude: f.longitude
  })));

  sel = 0;
  drawMap();
  renderSubscriptionSupplier();
}

function shortDay(value) {
  return titleCase(String(value || '')).slice(0, 3);
}

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function localDateIso() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function dayName(value) {
  const key = String(value || '').toLowerCase();
  const names = { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };
  return names[key] || key;
}

function renderRouteChoices() {
  const availableZones = [...new Set(zoneSchedules.map(route => route.delivery_zone))];
  const zoneContainer = $('#zone');
  if (!availableZones.length) {
    if (zoneContainer) zoneContainer.innerHTML = '<small class="mute">District schedules unavailable.</small>';
    deliveryFee = null;
    calc();
    return;
  }
  if (!availableZones.includes(S.zone)) S.zone = availableZones[0];
  selectedZone = S.zone;
  chips('#zone', availableZones, S.zone, zone => {
    S.zone = zone;
    selectedZone = zone;
    renderRouteChoices();
  });
  const routes = zoneSchedules.filter(route => route.delivery_zone === S.zone);
  const days = routes.map(route => shortDay(route.delivery_day));
  if (!days.includes(S.day)) S.day = days[0];
  const dayLabel = $('#deliveryDayLabel');
  if (dayLabel) dayLabel.textContent = `Fixed delivery days in ${S.zone}`;
  chips('#day', days, S.day, day => {
    S.day = day;
    renderRouteChoices();
  });
  const route = routes.find(item => shortDay(item.delivery_day) === S.day);
  deliveryFee = route ? Number(route.delivery_fee) : null;
  calc();
}

async function loadDeliveryRoutes() {
  const [zoneData, routeData] = await Promise.all([
    apiRequest('zones'),
    apiRequest('route_batches')
  ]);
  zoneSchedules = zoneData.zones || [];
  const routes = routeData.routes || [];
  const summary = $('#homeRouteSummary');
  if (summary) {
    summary.innerHTML = routes.length
      ? routes.map(route => `<span class="route-day">${escapeHtml(route.delivery_zone)} · ${escapeHtml(shortDay(route.delivery_day))} · ${peso(Number(route.delivery_fee))}</span>`).join('')
      : '<small class="mute">No active district routes are configured.</small>';
  }
  renderRouteChoices();
}

function renderSubscriptionSupplier() {
  const container = $('#subscriptionSupplier');
  if (!container) return;
  const supplier = FARMS.find(farm => Number(farm.farm_id) === Number(selectedSupplierId));
  if (!supplier) {
    container.innerHTML = `<small class="mute">No supplier selected yet. You can browse and choose a local farm or shop.</small>
      <button class="btn alt" type="button" data-go="map">Browse suppliers</button>`;
    bindGo(container);
    return;
  }
  container.innerHTML = `<span><b>${escapeHtml(supplier.n)}</b><small>${escapeHtml(supplier.t)} · ${escapeHtml(supplier.address || 'Address not listed')}</small></span>
    <button class="btn alt" type="button" id="changeSupplier">Change</button>`;
  $('#changeSupplier').onclick = () => go('map');
}

async function loadMySubscription() {
  const data = await apiRequest('my_subscription', {
    params: { user_id: 1 }
  });

  const subscription = data.subscription;

  activeSubscriptionId = subscription
    ? Number(subscription.subscription_id)
    : null;

  activeSubscriptionStatus = subscription
    ? subscription.status
    : null;

  const heroSchedule = $('#heroNextDelivery');
  if (!heroSchedule) return;
  if (!subscription) {
    heroSchedule.textContent = 'No active subscription yet';
    return;
  }
  const deliveryDate = String(subscription.next_delivery_date || '');
  const parsedDate = new Date(`${deliveryDate}T00:00:00`);
  const dateLabel = Number.isNaN(parsedDate.getTime())
    ? 'Date not set'
    : parsedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const overdue = subscription.status === 'active' && deliveryDate < localDateIso();
  const windowLabel = subscription.delivery_window ? ` · ${subscription.delivery_window}` : '';
  heroSchedule.textContent = `${overdue ? 'Needs attention · ' : subscription.status === 'paused' ? 'Paused · ' : ''}${dateLabel}${windowLabel}`;
}

async function loadNotifications() {
  const container = $('#notifications');
  if (!container) return;
  const data = await apiRequest('notifications', { params: { user_id: 1 } });
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  container.innerHTML = notifications.length
    ? notifications.map(item => `<div class="item"><div><b>${escapeHtml(titleCase(item.notification_type.replace(/_/g, ' ')))}</b><small>${escapeHtml(item.message)}</small></div></div>`).join('')
    : '<small class="mute">No new delivery notes. We’ll leave reminders here when they’re due.</small>';
}

async function loadDeliveryOrders() {
  const container = $('#deliveryHistory');
  if (!container) return;
  const data = await apiRequest('delivery_orders', { params: { user_id: 1 } });
  const deliveries = Array.isArray(data.deliveries) ? data.deliveries : [];
  const reviewOrder = deliveries.find(order =>
    order.batch_code && String(order.order_status).toLowerCase() === 'delivered'
  );
  selectedReviewBatch = reviewOrder ? reviewOrder.batch_code : '';
  const reviewLabel = $('#reviewBatchLabel');
  const reviewButton = $('#submitReview');
  if (reviewLabel) {
    reviewLabel.textContent = reviewOrder
      ? `${reviewOrder.batch_code} · ${reviewOrder.farm_name || 'Farm not listed'}`
      : 'A batch code is needed before you can leave a verified review.';
  }
  if (reviewButton) reviewButton.disabled = !reviewOrder;
  container.innerHTML = deliveries.length
    ? deliveries.map(order => `<div class="item">
        <div><b>${escapeHtml(order.product_name)} · ${escapeHtml(order.order_status.replace(/_/g, ' '))}</b>
          <small>${escapeHtml(order.delivery_date)} · ${Number(order.quantity)} pack(s)
          ${order.batch_code ? ` · Laid ${escapeHtml(order.laying_date || 'date not recorded')} · ${escapeHtml(order.farm_name || 'Farm not listed')} · Grade ${escapeHtml(order.grade_label || 'Ungraded')}` : ' · Batch details pending'}</small>
          ${order.batch_code ? `<button class="link" type="button" data-delivery-batch="${escapeHtml(order.batch_code)}">View batch</button>` : ''}
        </div>
      </div>`).join('')
    : '<small class="mute">Your orders and assigned batch details will appear here once a delivery is scheduled.</small>';
  container.querySelectorAll('[data-delivery-batch]').forEach(button => {
    button.onclick = () => {
      $('#code').value = button.dataset.deliveryBatch;
      go('trace');
      lookupBatchFromDatabase();
    };
  });

  const traceContainer = $('#traceDeliveryHistory');
  if (traceContainer) {
    const eligibleOrders = deliveries.filter(order =>
      !['cancelled', 'skipped'].includes(String(order.order_status).toLowerCase())
    );
    const activeOrders = eligibleOrders
      .filter(order => ['pending', 'confirmed', 'packed', 'out_for_delivery'].includes(String(order.order_status).toLowerCase()))
      .sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)));
    const deliveredOrders = eligibleOrders
      .filter(order => String(order.order_status).toLowerCase() === 'delivered')
      .sort((a, b) => String(b.delivery_date).localeCompare(String(a.delivery_date)));
    const currentOrder = activeOrders.length
      ? (activeOrders[0].batch_code ? activeOrders[0] : null)
      : (deliveredOrders[0] || null);
    const batches = eligibleOrders.filter(order => order.batch_code);

    renderCurrentBatch(currentOrder, activeOrders[0] || deliveredOrders[0] || null);
    traceContainer.innerHTML = batches.length
      ? batches.map(order => `<div class="item">
          <div>
            <b>${escapeHtml(order.product_name)}</b>
            <small>${escapeHtml(batchOrderLabel(order))} · ${escapeHtml(formatTraceDate(order.delivery_date))} · ${escapeHtml(order.farm_name || 'Farm not listed')} · Batch ${escapeHtml(order.batch_code)}</small>
          </div>
          <button class="btn alt" type="button" data-trace-batch="${escapeHtml(order.batch_code)}">View batch</button>
        </div>`).join('')
      : '<small class="mute">No batch has been assigned to an order yet. Once an order is prepared and linked to a farm batch, its details will appear here. You can also look up the code printed on your carton.</small>';
    traceContainer.querySelectorAll('[data-trace-batch]').forEach(button => {
      button.onclick = () => {
        $('#code').value = button.dataset.traceBatch;
        lookupBatchFromDatabase();
      };
    });
  }
}

function batchOrderLabel(order) {
  const status = String(order.order_status || '').toLowerCase();
  if (status === 'delivered') return 'Delivered';
  if (status === 'out_for_delivery') return 'Out for delivery';
  if (status === 'packed') return 'Packed for delivery';
  return 'Assigned to upcoming delivery';
}

function renderCurrentBatch(orderWithBatch, nextOrder) {
  const container = $('#currentBatch');
  if (!container) return;

  if (orderWithBatch) {
    const delivered = String(orderWithBatch.order_status).toLowerCase() === 'delivered';
    container.innerHTML = `
      <span class="eyebrow">${delivered ? 'LATEST DELIVERED BATCH' : 'BATCH ASSIGNED TO YOUR DELIVERY'}</span>
      <div class="current-batch-heading">
        <div>
          <h2>${escapeHtml(orderWithBatch.product_name || 'Your eggs')}</h2>
          <p>${escapeHtml(batchOrderLabel(orderWithBatch))} · ${escapeHtml(formatTraceDate(orderWithBatch.delivery_date))}${orderWithBatch.delivery_window ? ` · ${escapeHtml(orderWithBatch.delivery_window)}` : ''}</p>
        </div>
        <span class="batch-code">${escapeHtml(orderWithBatch.batch_code)}</span>
      </div>
      <div class="batch-facts">
        <span><small>From</small><b>${escapeHtml(orderWithBatch.farm_name || 'Farm not listed')}</b></span>
        <span><small>Laid</small><b>${escapeHtml(orderWithBatch.laying_date ? formatTraceDate(orderWithBatch.laying_date) : 'Date not recorded')}</b></span>
        <span><small>Grade</small><b>${escapeHtml(orderWithBatch.grade_label || 'Not graded yet')}</b></span>
      </div>
      <button class="btn" type="button" data-current-batch="${escapeHtml(orderWithBatch.batch_code)}">See this batch</button>
    `;
    container.querySelector('[data-current-batch]').onclick = () => {
      $('#code').value = orderWithBatch.batch_code;
      lookupBatchFromDatabase();
    };
    return;
  }

  const hasUnassignedOrder = nextOrder && !['delivered', 'cancelled', 'skipped'].includes(String(nextOrder.order_status).toLowerCase());
  container.innerHTML = `
    <span class="eyebrow">${hasUnassignedOrder ? 'YOUR NEXT DELIVERY' : 'BATCH ASSIGNMENT'}</span>
    <h2>${hasUnassignedOrder ? `${escapeHtml(nextOrder.product_name || 'Your eggs')} · ${escapeHtml(formatTraceDate(nextOrder.delivery_date))}` : 'Your batch will appear here'}</h2>
    <p class="trace-help">${hasUnassignedOrder
      ? `Order #${escapeHtml(nextOrder.order_id)} does not have a farm batch linked yet. We’ll show the actual farm, laying date, grade, and batch code here once it is assigned.`
      : 'There isn’t a batch linked to an upcoming or delivered order yet. After your eggs are assigned to a farm batch, you’ll see the actual source and handling dates here.'}</p>
    <p class="batch-truth">Your preferred supplier is not a batch assignment. We only show a farm here when it is linked to your order.</p>
  `;
}

async function refreshDeliveryDashboard() {
  await Promise.all([
    loadMySubscription(),
    loadUpcomingSubscriptions(),
    loadNotifications(),
    loadDeliveryOrders()
  ]);
}

async function lookupBatchFromDatabase() {
  const code = $('#code')?.value.trim().toUpperCase();

  if (!code) {
    toast('Enter a batch code first.');
    return;
  }

  $('#res').innerHTML = '<div class="card"><small class="mute">Looking up batch…</small></div>';

  try {
    const data = await apiRequest('batch', {
      params: { code }
    });

    const b = data.batch;

    const steps = [
      ['Laid', b.laying_date ? formatTraceDate(b.laying_date) : 'Date not recorded'],
      ['Received from farm', b.received_date ? formatTraceDate(b.received_date) : 'Date not recorded'],
      ['Quality graded', `${b.grade_label || 'Grade not recorded'}${b.graded_date ? ` · ${formatTraceDate(b.graded_date)}` : ''}`],
      ['Packed', b.packed_date ? formatTraceDate(b.packed_date) : 'Date not recorded']
    ];
    const laidDaysAgo = b.laying_date ? daysSinceDate(b.laying_date) : null;
    const layingAge = laidDaysAgo === null
      ? 'Laying date unavailable'
      : laidDaysAgo === 0
        ? 'Laid today'
        : `Laid ${laidDaysAgo} day${laidDaysAgo === 1 ? '' : 's'} ago`;

    $('#res').innerHTML = `<div class="grid trace-result">
      <div class="card">
        <span class="eyebrow">BATCH HISTORY</span>
        <h2>${escapeHtml(b.product_name)}</h2>
        <p class="trace-help">Batch ${escapeHtml(b.batch_code)} · Farm-to-pack record</p>
        <div class="batch-facts">
          <span><small>Source</small><b>${escapeHtml(b.farm_name || 'Farm not listed')}</b></span>
          <span><small>Quality grade</small><b>${escapeHtml(b.grade_label || 'Not recorded')}</b></span>
          <span><small>Best before</small><b>${escapeHtml(b.expiry_date ? formatTraceDate(b.expiry_date) : 'Date not recorded')}</b></span>
        </div>
        <ul class="tl">${steps.map(s =>
          `<li><b>${escapeHtml(s[0])}</b><small>${escapeHtml(s[1])}</small></li>`
        ).join('')}</ul>
      </div>
      <div class="card">
        <span class="eyebrow">SOURCE FARM</span>
        <h2>${escapeHtml(b.farm_name || 'Farm not listed')}</h2>
        <div class="batch-age">${escapeHtml(layingAge)}</div>
        <small>Based on the recorded laying date; this is not a freshness or safety assessment.</small>
        <div class="item" style="margin-top:14px">
          <div><b>Best before</b>
          <small>${b.expiry_date ? escapeHtml(formatTraceDate(b.expiry_date)) : 'Date not recorded'}</small></div>
        </div>
        <small class="trace-address">${escapeHtml(b.address || 'Farm address not listed')}</small>
        <button class="btn alt full" id="seeFarm">View farm details</button>
      </div>
    </div>`;

    $('#seeFarm').onclick = () => {
      const index = FARMS.findIndex(f => f.farm_id === Number(b.farm_id));

      if (index >= 0) {
        pick(index);
        go('map');
      } else {
        toast('This farm is not listed in the current farm directory.');
      }
    };
  } catch (e) {
    $('#res').innerHTML = `<div class="card trace-error"><b>Couldn’t find that batch.</b><small>${escapeHtml(e.message || 'Check the code and try again.')}</small></div>`;
    apiToastError(e);
  }
}

function formatTraceDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function daysSinceDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86400000));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

/* ---------- Upcoming deliveries ---------- */

async function loadUpcomingSubscriptions() {
  const list = $('#homeDeliveryList');
  const heading = $('#homeDeliveryTitle');

  if (!list || !heading) {
    console.error('Upcoming deliveries HTML elements are missing.');
    return;
  }

  list.innerHTML = `
    <div class="item">
      <div>
        <b>Loading subscriptions...</b>
        <small>Retrieving your delivery schedule.</small>
      </div>
      <span class="pill">Loading</span>
    </div>
  `;

  try {
    const data = await apiRequest('upcoming_subscriptions', {
      params: { user_id: 1 }
    });

    const subscriptions = Array.isArray(data.subscriptions)
      ? data.subscriptions
      : [];

    const activeSubscriptions = subscriptions.filter(item =>
      ['active', 'paused'].includes(String(item.status || '').toLowerCase())
    );

    if (activeSubscriptions.length === 0) {
      heading.textContent = 'Upcoming deliveries';

      list.innerHTML = `
        <div class="item">
          <div>
            <b>No upcoming deliveries</b>
            <small>Choose a product and route day to set up recurring delivery.</small>
          </div>
          <span class="pill">None</span>
        </div>
      `;

      list.onclick = null;
      return;
    }

    // Sort deliveries by date, earliest first.
    activeSubscriptions.sort((a, b) =>
      String(a.next_delivery_date || '')
        .localeCompare(String(b.next_delivery_date || ''))
    );

    const firstDate = new Date(
      `${activeSubscriptions[0].next_delivery_date}T12:00:00`
    );

    const firstDateLabel = firstDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
      });
    const firstIsOverdue = activeSubscriptions[0].status === 'active' &&
      String(activeSubscriptions[0].next_delivery_date) < localDateIso();
    heading.textContent = firstIsOverdue
      ? `Delivery needs attention · ${firstDateLabel}`
      : `Upcoming deliveries · ${firstDateLabel}`;

    list.innerHTML = activeSubscriptions.map(item => {
      const id = Number(item.subscription_id);
      const quantity = Number(item.quantity) || 0;
      const packageUnit = escapeHtml(item.unit || 'pack');

      const date = new Date(
        `${item.next_delivery_date}T12:00:00`
      );

      const dateLabel = Number.isNaN(date.getTime())
        ? 'Date unavailable'
        : date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });

      const product = escapeHtml(
        item.product_name || 'Egg product'
      );

      const size = escapeHtml(
        item.size_name || 'Size not listed'
      );

      const preferredSupplier = escapeHtml(
        item.preferred_supplier_name || 'No supplier preference'
      );
      const status = String(item.status || '').toLowerCase();
      const isOverdue = status === 'active' &&
        String(item.next_delivery_date) < localDateIso();

      const windowLabel = item.delivery_window
        ? ' · ' + escapeHtml(item.delivery_window)
        : '';

      const actionButtons = `
        <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn alt" data-subscription-action="edit" data-subscription-id="${id}">Change plan</button>
          ${status === 'active'
            ? `<button type="button" class="btn alt" data-subscription-action="skipped" data-subscription-id="${id}">Skip next</button>
               <button type="button" class="btn alt" data-subscription-action="paused" data-subscription-id="${id}">Pause</button>`
            : `<button type="button" class="btn alt" data-subscription-action="active" data-subscription-id="${id}">Resume</button>`}
          <button type="button" class="btn alt" data-subscription-action="cancelled" data-subscription-id="${id}">Cancel</button>
        </div>
      `;

      return `
        <div class="item"
             style="align-items:flex-start;padding:14px 0">
          <div style="flex:1;min-width:0">
            <b>${quantity} ${quantity === 1 ? packageUnit : `${packageUnit}s`} ${product}</b>

            <small>
              ${size} · Preferred supplier: ${preferredSupplier} · ${titleCase(item.delivery_zone)} route · Delivery: ${dateLabel}${windowLabel}
              · Subscription #${id}
            </small>

            ${actionButtons}
          </div>

          <span class="pill">${status === 'paused' ? 'Paused' : isOverdue ? 'Past due' : 'Scheduled'}</span>
        </div>
      `;
    }).join('');

    list.onclick = async event => {
      const button = event.target.closest('[data-subscription-action]');

      if (!button || !list.contains(button)) return;

      const subscriptionId = Number(
        button.dataset.subscriptionId
      );

      if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
        toast('Invalid subscription ID.');
        return;
      }

      const action = button.dataset.subscriptionAction;
      const selected = activeSubscriptions.find(item => Number(item.subscription_id) === subscriptionId);
      if (action === 'edit') {
        openSubscriptionEditor(selected);
        return;
      }
      if (action === 'skipped' && !window.confirm(`Skip the next delivery for subscription #${subscriptionId}?`)) return;
      if (action === 'cancelled' && !window.confirm(`Cancel subscription #${subscriptionId}?`)) return;

      button.disabled = true;
      try {
        if (action === 'skipped') await skipSubscriptionDelivery(subscriptionId);
        else await changeSubscriptionStatus(action, subscriptionId);
        await refreshDeliveryDashboard();
      } catch (error) {
        apiToastError(error);
        button.disabled = false;
      }
    };

  } catch (error) {
    console.error('Unable to load upcoming subscriptions:', error);

    heading.textContent = 'Upcoming deliveries';

    list.innerHTML = `
      <div class="item">
        <div>
          <b>Unable to load deliveries</b>
          <small>${escapeHtml(
            error.message || 'Check your API connection and refresh.'
          )}</small>
        </div>
        <span class="pill">Error</span>
      </div>
    `;
  }
}

/* ---------- Subscription actions ---------- */

async function createSubscriptionInDatabase() {
  const product = S.v;

  if (!product.product_id) {
    toast('The selected product is not connected to a database record yet.');
    return;
  }

  try {
    const data = await apiRequest('create_subscription', {
      method: 'POST',
      body: {
        user_id: 1,
        product_id: product.product_id,
        quantity: S.q,
        frequency: S.freq === 'Every 2 weeks'
          ? 'biweekly'
          : S.freq.toLowerCase(),
        delivery_day: dayName(S.day),
        delivery_window: S.win,
        delivery_address: `Demo address, ${S.zone}`,
        delivery_zone: S.zone,
        supplier_id: selectedSupplierId
      }
    });

    activeSubscriptionId = Number(data.subscription_id);
    activeSubscriptionStatus = 'active';

    toast(`Subscription saved! ID #${activeSubscriptionId}`);

    await refreshDeliveryDashboard();
  } catch (e) {
    apiToastError(e);
  }
}

function populateEditorDays(zone, selectedDay) {
  const routes = zoneSchedules.filter(route => route.delivery_zone === zone);
  $('#editDay').innerHTML = routes.map(route =>
    `<option value="${escapeHtml(route.delivery_day)}">${escapeHtml(titleCase(route.delivery_day))} · ${peso(Number(route.delivery_fee))}</option>`
  ).join('');
  if (selectedDay && routes.some(route => route.delivery_day === selectedDay)) {
    $('#editDay').value = selectedDay;
  }
}

function openSubscriptionEditor(item) {
  if (!item || !$('#subscriptionDialog')?.showModal) {
    toast('Subscription details are unavailable. Please refresh and try again.');
    return;
  }
  subscriptionBeingEdited = item;
  $('#editSubscriptionId').value = item.subscription_id;
  $('#editProduct').innerHTML = apiProducts.map(product =>
    `<option value="${Number(product.product_id)}">${escapeHtml(product.product_name)} · ${peso(Number(product.price))}/${escapeHtml(product.unit)}</option>`
  ).join('');
  $('#editProduct').value = String(item.product_id);
  $('#editQuantity').value = item.quantity;
  $('#editFrequency').value = item.frequency;
  const zones = [...new Set(zoneSchedules.map(route => route.delivery_zone))];
  $('#editZone').innerHTML = zones.map(zone =>
    `<option value="${escapeHtml(zone)}">${escapeHtml(zone)}</option>`
  ).join('');
  $('#editZone').value = item.delivery_zone;
  populateEditorDays(item.delivery_zone, item.delivery_day);
  $('#editWindow').value = item.delivery_window || '6–8 AM';
  $('#editSupplier').innerHTML = `<option value="">No supplier preference</option>` +
    FARMS.map(farm => `<option value="${Number(farm.farm_id)}">${escapeHtml(farm.n)}</option>`).join('');
  $('#editSupplier').value = item.supplier_id == null ? '' : String(item.supplier_id);
  $('#subscriptionDialog').showModal();
}

$('#editZone')?.addEventListener('change', event => populateEditorDays(event.target.value));
$('#closeSubscriptionDialog')?.addEventListener('click', () => $('#subscriptionDialog').close());
$('#cancelSubscriptionEdit')?.addEventListener('click', () => $('#subscriptionDialog').close());
$('#subscriptionEditor')?.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    const data = await apiRequest('update_subscription', {
      method: 'POST',
      body: {
        user_id: 1,
        subscription_id: Number($('#editSubscriptionId').value),
        product_id: Number($('#editProduct').value),
        quantity: Number($('#editQuantity').value),
        frequency: $('#editFrequency').value,
        delivery_zone: $('#editZone').value,
        delivery_day: $('#editDay').value,
        delivery_window: $('#editWindow').value,
        delivery_address: subscriptionBeingEdited.delivery_address || `Demo address, ${$('#editZone').value}`,
        supplier_id: $('#editSupplier').value || null
      }
    });
    $('#subscriptionDialog').close();
    toast(data.message || 'Subscription updated.');
    await refreshDeliveryDashboard();
  } catch (error) {
    apiToastError(error);
  } finally {
    if (submit) submit.disabled = false;
  }
});

async function changeSubscriptionStatus(status, subscriptionId) {
  if (!subscriptionId) {
    throw new Error('No subscription was selected.');
  }

  if (!['active', 'paused', 'cancelled'].includes(status)) {
    throw new Error('Invalid subscription action.');
  }

  const data = await apiRequest('subscription_status', {
    method: 'POST',
    body: {
      user_id: 1,
      subscription_id: subscriptionId,
      status
    }
  });

  if (data.success === false) {
    throw new Error(data.message || 'Unable to cancel subscription.');
  }

  toast(status === 'paused' ? 'Subscription paused.' : status === 'active' ? 'Subscription resumed.' : 'Subscription cancelled.');

  return data;
}

async function skipSubscriptionDelivery(subscriptionId) {
  const data = await apiRequest('skip_delivery', {
    method: 'POST',
    body: {
      user_id: 1,
      subscription_id: subscriptionId
    }
  });
  toast(data.message || 'Next delivery skipped.');
}

async function requestTradeAccount() {
  const businessName = document
    .querySelector('#biz input[aria-label="Business name"]')
    ?.value.trim();

  if (!businessName) {
    toast('Please enter your business name.');
    return;
  }

  try {
    const data = await apiRequest('trade_request', {
      method: 'POST',
      body: {
        user_id: 1,
        product_id: Number(B.productId),
        business_name: businessName,
        trays_per_delivery: B.t,
        deliveries_per_week: Number(B.wk),
        delivery_window: B.win
      }
    });

    toast(`${data.message} Contact: ${data.account_manager}.`);
    await loadNotifications();
  } catch (e) {
    apiToastError(e);
  }
}

$('#breakageForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const batchCode = selectedReviewBatch || $('#code').value.trim().toUpperCase();
    const data = await apiRequest('breakage_claim', {
      method: 'POST',
      body: {
        user_id: 1,
        batch_code: batchCode,
        damaged_count: Number($('#breakageCount').value),
        requested_resolution: $('#breakageRemedy').value,
        notes: $('#breakageNotes').value.trim()
      }
    });
    toast(data.message || 'Claim received for review.');
    form.reset();
    form.hidden = true;
    await loadNotifications();
  } catch (error) {
    apiToastError(error);
  } finally {
    submit.disabled = false;
  }
});

$('#submitReview')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!selectedReviewBatch || !selectedRating) {
    toast('Choose a delivered batch and select a star rating first.');
    return;
  }
  button.disabled = true;
  try {
    await apiRequest('submit_review', {
      method: 'POST',
      body: {
        user_id: 1,
        batch_code: selectedReviewBatch,
        rating: selectedRating,
        review_text: $('#reviewText').value.trim()
      }
    });
    toast('Your review is now part of the farm’s community rating.');
    selectedRating = 0;
    rate.querySelectorAll('button').forEach(star => star.classList.remove('on'));
    $('#reviewText').value = '';
    await loadFarmsFromDatabase();
  } catch (error) {
    apiToastError(error);
  } finally {
    button.disabled = false;
  }
});

/* ---------- Bind database actions ---------- */

if ($('#start')) {
  $('#start').onclick = createSubscriptionInDatabase;
}

if ($('#lookup')) {
  $('#lookup').onclick = lookupBatchFromDatabase;
}

if ($('#code')) {
  $('#code').onkeydown = e => {
    if (e.key === 'Enter') lookupBatchFromDatabase();
  };
}

if ($('#quote')) {
  $('#quote').onclick = requestTradeAccount;
}

/* ---------- Initialize database features ---------- */

(async function initializeDatabaseFeatures() {
  try {
    const health = await apiRequest('health');

    console.info('DOSENAMO API connected:', health.database);

    const results = await Promise.allSettled([
      loadProductsFromDatabase(),
      loadFarmsFromDatabase(),
      loadDeliveryRoutes(),
      loadMySubscription(),
      loadUpcomingSubscriptions(),
      loadNotifications(),
      loadDeliveryOrders()
    ]);

    let failed = false;
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failed = true;
        console.error(
          [
            'Unable to load products:',
            'Unable to load farms:',
            'Unable to load district routes:',
            'Unable to load active subscription:',
            'Unable to load upcoming subscriptions:',
            'Unable to load notifications:',
            'Unable to load delivery batches:'
          ][index],
          result.reason
        );
        if (index === 1) $('#farmList').innerHTML = '<small class="mute">Supplier directory is unavailable. Check the database connection.</small>';
            if (index === 0) {
              $('#variety').innerHTML = '<small class="mute">Product catalog is unavailable. Check the database connection.</small>';
              if ($('#quote')) $('#quote').disabled = true;
            }
        if (index === 2) {
          $('#homeRouteSummary').textContent = 'District routes are unavailable.';
          $('#zone').innerHTML = '<small class="mute">Delivery schedule unavailable.</small>';
          $('#day').innerHTML = '';
        }
        if (index === 5) $('#notifications').innerHTML = '<small class="mute">Delivery notes are unavailable.</small>';
        if (index === 6) {
          $('#deliveryHistory').innerHTML = '<small class="mute">Delivery records are unavailable.</small>';
          const currentBatch = $('#currentBatch');
          const traceHistory = $('#traceDeliveryHistory');
          if (currentBatch) currentBatch.innerHTML = '<b>Your batch details are unavailable.</b><small>We couldn’t load your order records. Please try again later.</small>';
          if (traceHistory) traceHistory.innerHTML = '<small class="mute">Your assigned batches are unavailable because order records could not be loaded.</small>';
        }
      }
    });

    toast(failed
      ? 'Some live features are unavailable. Please try again later.'
      : 'Your delivery dashboard is up to date.');
  } catch (error) {
    console.error('DOSENAMO initialization failed:', error);

    const list = $('#homeDeliveryList');

    if (list) {
      list.innerHTML = `<div class="item">
        <div>
          <b>Unable to connect to the database</b>
          <small>${escapeHtml(error.message || 'Check that Apache and MySQL are running.')}</small>
        </div>
        <span class="pill">Error</span>
      </div>`;
    }

    toast('Database connection failed. Check the console.');
  }
})();
