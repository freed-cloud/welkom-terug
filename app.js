'use strict';
/*
 * Welkom Terug – demo van een persoonlijk menu zonder app.
 * Alles draait in de browser van de tablet. Pincodes worden nooit opgeslagen,
 * alleen een gezouten PBKDF2-hash. Zie SECURITY.md voor de keuzes.
 */

// Clickjacking-bescherming
if (window.top !== window.self) { document.documentElement.hidden = true; try { window.top.location = window.self.location; } catch (e) {} }

(() => {
  const KEY = 'welkomterug-v1';
  const PBKDF2_ROUNDS = 150000;
  const MAX_TRIES = 5;          // foute pogingen voordat een profiel tijdelijk op slot gaat
  const LOCK_MINUTES = 15;
  const IDLE_SECONDS = 90;      // gastscherm gaat na zoveel seconden stilte terug naar het begin
  const STAFF_IDLE_SECONDS = 300;

  const DEMO_MENU = [
    ['Koffie', 'Warme dranken', 2.9], ['Cappuccino', 'Warme dranken', 3.4], ['Thee', 'Warme dranken', 2.7],
    ['Verse jus d\'orange', 'Koude dranken', 4.2], ['Spa rood', 'Koude dranken', 2.9],
    ['Tosti ham-kaas', 'Lunch', 5.5], ['Uitsmijter', 'Lunch', 9.5], ['Broodje kroket', 'Lunch', 6.5], ['Soep van de dag', 'Lunch', 6.9],
    ['Stamppot van de week', 'Warm', 14.5], ['Appeltaart met slagroom', 'Zoet', 4.9]
  ];

  // ---------- Opslag ----------
  let db;
  const blank = () => ({ settings: null, menu: [], guests: [], queue: [] });
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)) || blank(); } catch (e) { db = blank(); }
    if (!db || typeof db !== 'object') db = blank();
    ['menu', 'guests', 'queue'].forEach(k => { if (!Array.isArray(db[k])) db[k] = []; });
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { alert('Opslaan lukt niet op dit apparaat.'); } }

  // ---------- Hulpjes ----------
  const $ = id => document.getElementById(id);
  const val = id => $(id).value.trim();
  const uid = () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); };
  const euro = n => '€ ' + Number(n).toFixed(2).replace('.', ',');
  const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  const nameKey = s => clean(s, 40).toLocaleLowerCase('nl-NL').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v; else el.setAttribute(k, v);
    });
    kids.flat().forEach(c => el.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return el;
  }
  const fmtDate = iso => new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

  // ---------- Pincodes: PBKDF2 met eigen salt per profiel ----------
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function hashPin(pin, saltB64) {
    const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS }, key, 256);
    return { hash: b64(bits), salt: b64(salt) };
  }
  function sameHash(a, b) { // vergelijking in constante tijd
    if (a.length !== b.length) return false;
    let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }
  async function checkPin(pin, rec) { const { hash } = await hashPin(pin, rec.salt); return sameHash(hash, rec.hash); }
  const isPin = (p, n) => new RegExp(`^\\d{${n}}$`).test(p);
  const weakPin = p => /^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p);

  // ---------- Schermen ----------
  let guest = null;   // ingelogde gast (of {anon:true})
  let cart = [];
  let staffOpen = false;
  function go(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'v-' + view));
    document.querySelectorAll('.error, .ok').forEach(e => { e.textContent = ''; });
    const renders = { welcome: renderWelcome, back: renderBack, menu: renderMenu, mydata: renderMyData, staff: renderStaff, register: renderRegister };
    if (renders[view]) renders[view]();
    window.scrollTo(0, 0);
    resetIdle();
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

  function logout() {
    guest = null; cart = []; staffOpen = false;
    document.querySelectorAll('input').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; });
    go('welcome');
  }

  // Automatisch terug naar het begin, zodat de volgende gast niets van de vorige ziet
  let idleTimer;
  function resetIdle() {
    clearTimeout(idleTimer);
    const active = document.querySelector('.view.active');
    if (!active || ['v-welcome', 'v-setup'].includes(active.id)) return;
    const secs = staffOpen ? STAFF_IDLE_SECONDS : (active.id === 'v-done' ? 8 : IDLE_SECONDS);
    idleTimer = setTimeout(logout, secs * 1000);
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, resetIdle, { passive: true }));

  // ---------- Eerste keer instellen ----------
  $('set-go').addEventListener('click', async () => {
    const name = clean(val('set-name'), 60), p1 = val('set-pin'), p2 = val('set-pin2');
    if (!name) return ($('set-err').textContent = 'Vul de naam van je zaak in.');
    if (!isPin(p1, 6)) return ($('set-err').textContent = 'De pincode moet uit 6 cijfers bestaan.');
    if (weakPin(p1)) return ($('set-err').textContent = 'Kies een minder voorspelbare pincode.');
    if (p1 !== p2) return ($('set-err').textContent = 'De pincodes zijn niet gelijk.');
    const pin = await hashPin(p1);
    db.settings = { name, staff: pin, retentionDays: 180, tries: 0, lockedUntil: 0 };
    db.menu = DEMO_MENU.map(([n, c, p]) => ({ id: uid(), name: n, cat: c, price: p, available: true }));
    save(); logout();
  });

  // ---------- Welkom en inloggen ----------
  function renderWelcome() {
    // privacy: op het beginscherm staat nooit nog iets van de vorige gast
    guest = null; cart = []; staffOpen = false;
    document.querySelectorAll('input').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; });
    $('w-place').textContent = db.settings ? db.settings.name : '';
  }

  $('w-login').addEventListener('click', async () => {
    const key = nameKey(val('w-name')), pin = val('w-pin');
    if (!key || !isPin(pin, 4)) return ($('w-err').textContent = 'Vul je voornaam en je pincode van 4 cijfers in.');
    $('w-login').disabled = true;
    try {
      const candidates = db.guests.filter(g => g.key === key);
      const now = Date.now();
      for (const g of candidates) {
        if (g.lockedUntil > now) continue;
        if (await checkPin(pin, g.pin)) {
          g.tries = 0; save();
          guest = g; go('back'); return;
        }
        g.tries = (g.tries || 0) + 1;
        if (g.tries >= MAX_TRIES) { g.lockedUntil = now + LOCK_MINUTES * 60000; g.tries = 0; }
      }
      save();
      const locked = candidates.some(g => g.lockedUntil > now);
      $('w-err').textContent = locked
        ? `Te veel foute pogingen. Probeer het over ${LOCK_MINUTES} minuten opnieuw of vraag het personeel.`
        : 'We herkennen deze combinatie niet. Controleer je voornaam en pincode.'; // geen hint of de naam bestaat
    } finally { $('w-login').disabled = false; $('w-pin').value = ''; }
  });
  $('w-pin').addEventListener('keydown', e => { if (e.key === 'Enter') $('w-login').click(); });
  $('w-new').addEventListener('click', () => go('register'));
  $('w-anon').addEventListener('click', () => { guest = { anon: true }; cart = []; go('menu'); });
  $('w-staff').addEventListener('click', () => go('staff-login'));

  // ---------- Registreren ----------
  function renderRegister() {
    const days = db.settings ? db.settings.retentionDays : 180;
    $('r-consent-txt').textContent = `Ik geef ${db.settings ? db.settings.name : 'deze zaak'} toestemming om mijn voornaam, vaste wensen en bestellingen te bewaren. Ben ik ${days} dagen niet geweest, dan wordt mijn profiel automatisch verwijderd. Ik kan het altijd zelf inzien en verwijderen.`;
  }
  $('r-go').addEventListener('click', async () => {
    const name = clean(val('r-name'), 40), p1 = val('r-pin'), p2 = val('r-pin2');
    if (!name) return ($('r-err').textContent = 'Vul je voornaam in.');
    if (!isPin(p1, 4)) return ($('r-err').textContent = 'Je pincode moet uit 4 cijfers bestaan.');
    if (weakPin(p1)) return ($('r-err').textContent = 'Kies een minder voorspelbare pincode, dus niet 1111 of 1234.');
    if (p1 !== p2) return ($('r-err').textContent = 'De pincodes zijn niet gelijk.');
    if (!$('r-consent').checked) return ($('r-err').textContent = 'Zonder toestemming kunnen we geen profiel bewaren. Je kunt ook zonder profiel bestellen.');
    // dezelfde naam + pincode zou inloggen onduidelijk maken
    for (const g of db.guests.filter(g => g.key === nameKey(name))) {
      if (await checkPin(p1, g.pin)) return ($('r-err').textContent = 'Kies een andere pincode.');
    }
    $('r-go').disabled = true;
    const pin = await hashPin(p1);
    const now = new Date().toISOString();
    guest = { id: uid(), name, key: nameKey(name), pin, wishes: clean(val('r-wish'), 120), createdAt: now, lastVisit: now, consentAt: now, orders: [], tries: 0, lockedUntil: 0 };
    db.guests.push(guest); save();
    $('r-go').disabled = false;
    cart = []; go('menu');
  });

  // ---------- Terugkerende gast ----------
  function favourites(g) {
    const count = {};
    g.orders.forEach(o => o.items.forEach(i => { count[i.id] = (count[i.id] || 0) + i.qty; }));
    return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([id]) => db.menu.find(m => m.id === id)).filter(m => m && m.available).slice(0, 4);
  }
  function renderBack() {
    if (!guest || guest.anon) return go('welcome');
    $('b-hello').textContent = `Welkom terug, ${guest.name}!`;
    const last = guest.orders[guest.orders.length - 1];
    $('b-last-card').hidden = !last;
    $('b-last').replaceChildren();
    if (last) {
      last.items.forEach(i => {
        const m = db.menu.find(x => x.id === i.id);
        const label = `${i.qty}× ${m ? m.name : i.name}` + (m && !m.available ? ' (nu niet beschikbaar)' : '');
        $('b-last').append(h('li', null, h('span', null, label)));
      });
    }
    const favs = favourites(guest);
    $('b-fav-card').hidden = !favs.length;
    $('b-fav').replaceChildren(...favs.map(m => h('button', { class: 'chip', onclick: () => { addToCart(m.id); go('menu'); } }, '+ ' + m.name)));
    $('b-wish').textContent = guest.wishes ? `Je vaste wensen: ${guest.wishes}` : '';
  }
  $('b-repeat').addEventListener('click', () => {
    const last = guest && guest.orders[guest.orders.length - 1];
    cart = [];
    if (last) last.items.forEach(i => { const m = db.menu.find(x => x.id === i.id && x.available); if (m) cart.push({ id: m.id, qty: i.qty }); });
    go('menu');
    if (last && last.note) $('m-note').value = last.note;
  });
  $('b-menu').addEventListener('click', () => { cart = []; go('menu'); });
  $('b-data').addEventListener('click', () => go('mydata'));
  $('b-out').addEventListener('click', logout);

  // ---------- Menu en winkelwagen ----------
  function addToCart(id) { const c = cart.find(x => x.id === id); if (c) c.qty = Math.min(c.qty + 1, 20); else cart.push({ id, qty: 1 }); }
  function renderMenu() {
    const cats = [...new Set(db.menu.filter(m => m.available).map(m => m.cat))];
    $('m-list').replaceChildren(...cats.map(cat => h('div', { class: 'cat' },
      h('h2', null, cat),
      db.menu.filter(m => m.available && m.cat === cat).map(m => h('div', { class: 'item' },
        h('span', null, m.name),
        h('span', null, h('span', { class: 'price' }, euro(m.price)), h('button', { class: 'add', 'aria-label': m.name + ' toevoegen', onclick: () => { addToCart(m.id); renderCart(); } }, '+')))))));
    if (!cats.length) $('m-list').append(h('p', { class: 'empty' }, 'Er staan nog geen gerechten op het menu.'));
    renderCart();
  }
  function renderCart() {
    cart = cart.filter(c => db.menu.some(m => m.id === c.id && m.available) && c.qty > 0);
    let total = 0;
    $('m-cart').replaceChildren(...cart.map(c => {
      const m = db.menu.find(x => x.id === c.id); total += m.price * c.qty;
      return h('li', null, h('span', null, m.name), h('span', { class: 'qty' },
        h('button', { 'aria-label': 'minder', onclick: () => { c.qty--; renderCart(); } }, '−'), String(c.qty),
        h('button', { 'aria-label': 'meer', onclick: () => { c.qty = Math.min(c.qty + 1, 20); renderCart(); } }, '+')));
    }));
    if (!cart.length) $('m-cart').append(h('li', { class: 'empty' }, 'Nog niets gekozen'));
    $('m-total').textContent = euro(total);
  }
  $('m-cancel').addEventListener('click', () => { cart = []; guest && !guest.anon ? go('back') : logout(); });
  $('m-order').addEventListener('click', () => {
    if (!cart.length) return ($('m-err').textContent = 'Kies eerst iets van het menu.');
    const items = cart.map(c => { const m = db.menu.find(x => x.id === c.id); return { id: m.id, name: m.name, qty: c.qty, price: m.price }; });
    const note = clean(val('m-note'), 140);
    const at = new Date().toISOString();
    db.queue.push({ id: uid(), guest: guest && !guest.anon ? guest.name : 'Gast', items, note, at, status: 'nieuw' });
    if (guest && !guest.anon) {
      guest.orders.push({ at, items: items.map(({ id, name, qty }) => ({ id, name, qty })), note });
      guest.orders = guest.orders.slice(-30); // niet meer bewaren dan nodig
      guest.lastVisit = at;
    }
    save(); cart = []; guest = null; go('done');
  });

  // ---------- Inzage en verwijderen ----------
  function renderMyData() {
    if (!guest || guest.anon) return go('welcome');
    const rows = [
      ['Voornaam', guest.name], ['Profiel aangemaakt', fmtDate(guest.createdAt)], ['Toestemming gegeven', fmtDate(guest.consentAt)],
      ['Laatste bezoek', fmtDate(guest.lastVisit)], ['Vaste wensen', guest.wishes || '–'], ['Aantal bewaarde bestellingen', guest.orders.length],
      ['Pincode', 'Niet opgeslagen. We bewaren alleen een versleutelde controlewaarde.']
    ];
    $('d-list').replaceChildren(...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, String(v))]));
  }
  $('d-download').addEventListener('click', () => {
    const { pin, key, tries, lockedUntil, ...data } = guest;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    h('a', { href: URL.createObjectURL(blob), download: 'mijn-gegevens.json' }).click();
  });
  $('d-delete').addEventListener('click', () => {
    if (!confirm('Weet je zeker dat je je profiel en al je bestellingen wilt verwijderen?')) return;
    db.guests = db.guests.filter(g => g.id !== guest.id); save(); logout();
  });

  // ---------- Personeel ----------
  $('s-go').addEventListener('click', async () => {
    const s = db.settings, pin = val('s-pin'), now = Date.now();
    $('s-pin').value = '';
    if (s.lockedUntil > now) return ($('s-err').textContent = `Te veel foute pogingen. Wacht ${LOCK_MINUTES} minuten.`);
    if (isPin(pin, 6) && await checkPin(pin, s.staff)) { s.tries = 0; save(); staffOpen = true; go('staff'); return; }
    s.tries = (s.tries || 0) + 1;
    if (s.tries >= MAX_TRIES) { s.lockedUntil = now + LOCK_MINUTES * 60000; s.tries = 0; }
    save();
    $('s-err').textContent = 'Onjuiste pincode.';
  });
  $('s-pin').addEventListener('keydown', e => { if (e.key === 'Enter') $('s-go').click(); });
  $('st-out').addEventListener('click', logout);

  let tab = 'orders';
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; renderStaff(); }));
  function renderStaff() {
    if (!staffOpen) return go('staff-login');
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 't-' + tab));
    ({ orders: renderOrders, menu: renderMenuAdmin, guests: renderGuests, settings: renderSettings })[tab]();
  }

  function renderOrders() {
    const open = db.queue.filter(o => o.status !== 'afgehaald').sort((a, b) => a.at.localeCompare(b.at));
    $('o-list').replaceChildren(...open.map(o => h('div', { class: 'order ' + o.status },
      h('header', null, h('span', null, o.guest), h('span', null, new Date(o.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) + ' · ' + o.status)),
      h('ul', null, o.items.map(i => h('li', null, `${i.qty}× ${i.name}`))),
      o.note ? h('p', { class: 'small' }, 'Opmerking: ' + o.note) : '',
      h('div', null,
        o.status === 'nieuw' ? h('button', { class: 'btn small', onclick: () => setOrder(o, 'bezig') }, 'In bereiding') : '',
        o.status !== 'klaar' ? h('button', { class: 'btn small', onclick: () => setOrder(o, 'klaar') }, 'Klaar') : '',
        h('button', { class: 'btn small ghost', onclick: () => setOrder(o, 'afgehaald') }, 'Afgehandeld')))));
    if (!open.length) $('o-list').append(h('p', { class: 'empty' }, 'Geen openstaande bestellingen.'));
  }
  function setOrder(o, status) {
    o.status = status;
    db.queue = db.queue.filter(x => x.status !== 'afgehaald' || Date.now() - new Date(x.at) < 864e5); // afgehandelde bestellingen na 24 uur weg
    save(); renderOrders();
  }

  function parsePrice(s) { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 100) / 100 : null; }
  function renderMenuAdmin() {
    $('mm-body').replaceChildren(...db.menu.map(m => h('tr', null,
      h('td', null, h('input', { value: m.name, maxLength: 50, onchange: e => { const v = clean(e.target.value, 50); if (v) { m.name = v; save(); } else e.target.value = m.name; } })),
      h('td', null, h('input', { value: m.cat, maxLength: 30, onchange: e => { const v = clean(e.target.value, 30); if (v) { m.cat = v; save(); } else e.target.value = m.cat; } })),
      h('td', null, h('input', { value: m.price.toFixed(2).replace('.', ','), maxLength: 7, onchange: e => { const p = parsePrice(e.target.value); if (p !== null) { m.price = p; save(); } e.target.value = m.price.toFixed(2).replace('.', ','); } })),
      h('td', null, h('input', { type: 'checkbox', checked: m.available, onchange: e => { m.available = e.target.checked; save(); } })),
      h('td', null, h('button', { class: 'btn small ghost', onclick: () => { db.menu = db.menu.filter(x => x !== m); save(); renderMenuAdmin(); } }, 'Verwijder')))));
  }
  $('mm-add').addEventListener('click', () => {
    const name = clean(val('mm-name'), 50), cat = clean(val('mm-cat'), 30), price = parsePrice(val('mm-price'));
    if (!name || !cat || price === null) return ($('mm-err').textContent = 'Vul een naam, categorie en geldige prijs in.');
    db.menu.push({ id: uid(), name, cat, price, available: true }); save();
    ['mm-name', 'mm-cat', 'mm-price'].forEach(i => { $(i).value = ''; }); $('mm-err').textContent = '';
    renderMenuAdmin();
  });

  function renderGuests() {
    $('g-ret').textContent = db.settings.retentionDays;
    $('g-body').replaceChildren(...db.guests.slice().sort((a, b) => b.lastVisit.localeCompare(a.lastVisit)).map(g => h('tr', null,
      h('td', null, g.name), h('td', null, fmtDate(g.lastVisit)), h('td', null, String(g.orders.length)),
      h('td', null,
        g.lockedUntil > Date.now() ? h('button', { class: 'btn small', onclick: () => { g.lockedUntil = 0; g.tries = 0; save(); renderGuests(); } }, 'Ontgrendel') : '',
        ' ',
        h('button', { class: 'btn small ghost', onclick: () => { if (confirm(`Profiel van ${g.name} verwijderen?`)) { db.guests = db.guests.filter(x => x !== g); save(); renderGuests(); } } }, 'Verwijder')))));
    if (!db.guests.length) $('g-body').append(h('tr', null, h('td', { colSpan: 4, class: 'empty' }, 'Nog geen gastprofielen.')));
  }

  function renderSettings() { $('cfg-name').value = db.settings.name; $('cfg-ret').value = db.settings.retentionDays; }
  $('cfg-save').addEventListener('click', () => {
    const name = clean(val('cfg-name'), 60), days = parseInt(val('cfg-ret'), 10);
    if (!name || !(days >= 1 && days <= 730)) return ($('cfg-ok').textContent = 'Vul een naam en een bewaartermijn tussen 1 en 730 dagen in.');
    db.settings.name = name; db.settings.retentionDays = days; purge(); save();
    $('cfg-ok').textContent = 'Opgeslagen.';
  });
  $('cfg-wipe').addEventListener('click', () => {
    if (!confirm('Alles wissen? Dit kan niet ongedaan worden gemaakt.')) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    load(); staffOpen = false; go('setup');
  });

  // ---------- Bewaartermijn bewaken ----------
  function purge() {
    if (!db.settings) return;
    const limit = Date.now() - db.settings.retentionDays * 864e5;
    db.guests = db.guests.filter(g => new Date(g.lastVisit).getTime() >= limit);
    db.queue = db.queue.filter(o => o.status !== 'afgehaald' || Date.now() - new Date(o.at) < 864e5);
  }

  // ---------- Start ----------
  load();
  if (!window.crypto || !crypto.subtle) {
    document.body.replaceChildren(h('main', null, h('h1', null, 'Deze browser wordt niet ondersteund'), h('p', null, 'Open de app via https in een recente browser.')));
    return;
  }
  purge(); save();
  go(db.settings ? 'welcome' : 'setup');
})();
