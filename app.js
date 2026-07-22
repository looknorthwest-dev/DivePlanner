// =========================================================
// Dive Trip Planner — app.js
//
// HOW THIS FILE FITS TOGETHER (for reference while you learn):
//   - This file runs entirely in the visitor's browser, AFTER
//     GitHub Pages has served index.html + this script to them.
//   - Every "supabase.from(...)" call below is a direct network
//     request from THEIR browser to YOUR Supabase project. GitHub
//     is not involved in that exchange at all — it only handed
//     over the files once, at the start.
//   - Row Level Security (defined in schema.sql) is what actually
//     enforces "you can only see/edit your own data" — this file
//     just asks Supabase for data; Supabase decides what's allowed.
// =========================================================

// ---------------------------------------------------------
// 1. CONFIG — fill these in from your Supabase project
//    (Project Settings > API in the Supabase dashboard)
// ---------------------------------------------------------
const SUPABASE_URL = 'https://zpttgmpdxpzfqjopezga.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gp07wzqDemB7J2KK4Jjd3g_dT9Yp9b-';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------
// 2. STATE
// ---------------------------------------------------------
let currentUser = null;
let trips = [];
let currentTripId = null;
let sortableInstances = {}; // keyed by list element id, so we can destroy/recreate cleanly

// ---------------------------------------------------------
// 3. TOAST (small "Saved" confirmation, non-blocking)
// ---------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1600);
}

// ---------------------------------------------------------
// 4. AUTH & EVENT LISTENERS
// ---------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');
  const authForm = document.getElementById('auth-form');
  const authError = document.getElementById('auth-error');

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleLogin();
    });
  }

  const signupBtn = document.getElementById('auth-signup-btn');
  if (signupBtn) {
    signupBtn.addEventListener('click', handleSignup);
  }

  const signOutBtn = document.getElementById('sign-out-btn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      location.reload();
    });
  }
});

async function handleLogin() {
  authError.hidden = true;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { showAuthError(error.message); return; }
  currentUser = data.user;
  await enterApp();
}

async function handleSignup() {
  authError.hidden = true;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || password.length < 6) {
    showAuthError('Enter an email and a password of at least 6 characters.');
    return;
  }
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) { showAuthError(error.message); return; }
  if (data.user && !data.session) {
    showAuthError('Check your email to confirm your account, then log in.');
    return;
  }
  currentUser = data.user;
  await enterApp();
}

function showAuthError(msg) {
  authError.textContent = msg;
  authError.hidden = false;
}

async function checkExistingSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    await enterApp();
  }
}

async function enterApp() {
  authScreen.hidden = true;
  appScreen.hidden = false;
  await loadTrips();
  wireStaticUI();
}

// ---------------------------------------------------------
// 5. TRIPS (the trip switcher + dive-computer readout header)
// ---------------------------------------------------------
const tripSelect = document.getElementById('trip-select');
const tripReadout = document.getElementById('trip-readout');

document.getElementById('new-trip-btn').addEventListener('click', async () => {
  const { data, error } = await supabase
    .from('trips')
    .insert({ owner_id: currentUser.id, name: 'New Trip' })
    .select()
    .single();
  if (error) { console.error(error); return; }
  trips.push(data);
  currentTripId = data.id;
  renderTripSelect();
  await loadTripDependentData();
});

tripSelect.addEventListener('change', async () => {
  currentTripId = tripSelect.value;
  await loadTripDependentData();
});

async function loadTrips() {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) { console.error(error); return; }
  trips = data || [];
  if (trips.length === 0) {
    // Give a first-time user a trip to start with instead of an empty picker
    const { data: newTrip } = await supabase
      .from('trips')
      .insert({ owner_id: currentUser.id, name: 'My First Dive Trip' })
      .select()
      .single();
    trips = [newTrip];
  }
  currentTripId = trips[0].id;
  renderTripSelect();
  await loadTripDependentData();
}

function renderTripSelect() {
  tripSelect.innerHTML = trips
    .map(t => `<option value="${t.id}" ${t.id === currentTripId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`)
    .join('');
}

function currentTrip() {
  return trips.find(t => t.id === currentTripId);
}

function renderReadout() {
  const trip = currentTrip();
  if (!trip) { tripReadout.hidden = true; return; }
  tripReadout.hidden = false;
  document.getElementById('readout-trip-name').value = trip.name || '';
  document.getElementById('readout-destination').value = trip.destination_name || '';
  document.getElementById('readout-start').value = trip.start_date || '';
  document.getElementById('readout-end').value = trip.end_date || '';

  const countdownEl = document.getElementById('readout-countdown');
  if (trip.start_date) {
    const days = Math.ceil((new Date(trip.start_date) - new Date()) / 86400000);
    countdownEl.textContent = days >= 0 ? `T-minus ${days}d` : `${Math.abs(days)}d elapsed`;
  } else {
    countdownEl.textContent = '—';
  }
}

function wireReadoutInputs() {
  const bindings = [
    ['readout-trip-name', 'name'],
    ['readout-destination', 'destination_name'],
    ['readout-start', 'start_date'],
    ['readout-end', 'end_date'],
  ];
  bindings.forEach(([elId, field]) => {
    document.getElementById(elId).addEventListener('change', async (e) => {
      const patch = { [field]: e.target.value || null };
      const { error } = await supabaseClient.from('trips').update(patch).eq('id', currentTripId);
      if (!error) {
        Object.assign(currentTrip(), patch);
        if (field === 'name') renderTripSelect();
        renderReadout();
        showToast('Saved');
      }
    });
  });
}

async function loadTripDependentData() {
  renderReadout();
  await Promise.all([
    loadCandidates(),
    loadShops(),
    loadSites(),
    loadFlights(),
    loadStays(),
  ]);
}

// ---------------------------------------------------------
// 6. TABS
// ---------------------------------------------------------
function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ---------------------------------------------------------
// 7. GENERIC CARD LIST ENGINE
//    Every list (dive shops, sites, flights, stays, gear,
//    certs) shares this rendering + editing + reordering logic.
//
//    THE DRAG FIX: SortableJS is configured with `handle:
//    '.drag-handle'`, meaning it only starts a drag when the
//    mouse goes down on that specific grip icon in the card's
//    title bar. Clicking or dragging anywhere else in the card
//    — including inside a notes textarea — is completely
//    ignored by Sortable, so text selection works normally.
// ---------------------------------------------------------

function fieldHtml(row, def) {
  const val = row[def.key] ?? '';
  const spanClass = def.full ? 'field full' : 'field';
  if (def.type === 'textarea') {
    return `<div class="${spanClass}"><label>${def.label}</label>
      <textarea data-key="${def.key}" rows="3">${escapeHtml(val)}</textarea></div>`;
  }
  if (def.type === 'select') {
    const opts = def.options.map(o =>
      `<option value="${o.value}" ${String(row[def.key]) === String(o.value) ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    return `<div class="${spanClass}"><label>${def.label}</label>
      <select data-key="${def.key}"><option value="">—</option>${opts}</select></div>`;
  }
  if (def.type === 'checkbox') {
    return `<div class="field checkbox"><input type="checkbox" data-key="${def.key}" ${val ? 'checked' : ''}>
      <label>${def.label}</label></div>`;
  }
  const inputType = def.type || 'text';
  return `<div class="${spanClass}"><label>${def.label}</label>
    <input type="${inputType}" data-key="${def.key}" value="${escapeAttr(val)}" ${def.step ? `step="${def.step}"` : ''}></div>`;
}

function renderCardList({ containerId, rows, fieldDefs, table, titleKey, extraBarHtml, extraFooter }) {
  const container = document.getElementById(containerId);
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">Nothing here yet — add your first one above.</div>`;
    return;
  }
  container.innerHTML = rows.map(row => `
    <div class="card" data-id="${row.id}">
      <div class="card-bar">
        <span class="drag-handle" title="Drag to reorder">⠿⠿</span>
        <input class="card-title-input" data-key="${titleKey}" value="${escapeAttr(row[titleKey] ?? '')}">
        <button class="btn btn-danger-ghost small btn-delete" title="Delete">Delete</button>
      </div>
      <div class="card-body">
        ${fieldDefs.map(def => fieldHtml(row, def)).join('')}
      </div>
      ${extraFooter ? `<div class="card-footer">${extraFooter(row)}</div>` : ''}
    </div>
  `).join('');

  // Wire every editable control: save on change/blur, never on every keystroke.
  container.querySelectorAll('.card').forEach(cardEl => {
    const id = cardEl.dataset.id;
    cardEl.querySelectorAll('[data-key]').forEach(el => {
      const eventName = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date' || el.type === 'datetime-local')
        ? 'change' : 'blur';
      el.addEventListener(eventName, async () => {
        const key = el.dataset.key;
        let value = el.type === 'checkbox' ? el.checked : el.value;
        if (value === '') value = null;
        const patch = { [key]: value };
        const { error } = await supabaseClient.from(table).update(patch).eq('id', id);
        if (error) { console.error(error); showToast('Save failed'); return; }
        const row = rows.find(r => r.id === id);
        if (row) Object.assign(row, patch);
        if (key === titleKey && table === 'trips') renderTripSelect();
        showToast('Saved');
      });
    });
    cardEl.querySelector('.btn-delete').addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      const { error } = await supabaseClient.from(table).delete().eq('id', id);
      if (error) { console.error(error); return; }
      const idx = rows.findIndex(r => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
      renderCardList({ containerId, rows, fieldDefs, table, titleKey, extraBarHtml, extraFooter });
    });
  });

  // Drag-to-reorder, restricted to the handle only (see note above).
  if (sortableInstances[containerId]) sortableInstances[containerId].destroy();
  sortableInstances[containerId] = new Sortable(container, {
    handle: '.drag-handle',
    animation: 150,
    onEnd: async () => {
      const ids = Array.from(container.children).map(el => el.dataset.id);
      await Promise.all(ids.map((id, index) => {
        const row = rows.find(r => r.id === id);
        if (row) row.position = index;
        return supabaseClient.from(table).update({ position: index }).eq('id', id);
      }));
      rows.sort((a, b) => a.position - b.position);
    },
  });
}

// ---------------------------------------------------------
// 8. DESTINATION CANDIDATES (compare tab + weather auto-fetch)
// ---------------------------------------------------------
let candidateRows = [];

const candidateFieldDefs = [
  { key: 'target_date', label: 'Target month/date', type: 'date' },
  { key: 'lat', label: 'Latitude', type: 'number', step: 'any' },
  { key: 'lng', label: 'Longitude', type: 'number', step: 'any' },
  { key: 'flight_cost', label: 'Flight cost', type: 'number', step: '0.01' },
  { key: 'package_cost', label: 'Package cost', type: 'number', step: '0.01' },
  { key: 'diving_cost', label: 'Diving cost', type: 'number', step: '0.01' },
  { key: 'dive_rating', label: 'Dive rating (0-1)', type: 'number', step: '0.01' },
  { key: 'experience_rating', label: 'Experience rating (0-1)', type: 'number', step: '0.01' },
  { key: 'weather_rating', label: 'Weather rating (0-1)', type: 'number', step: '0.01' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];

async function loadCandidates() {
  const { data, error } = await supabase
    .from('destination_candidates')
    .select('*')
    .eq('trip_id', currentTripId)
    .order('position', { ascending: true });
  if (error) { console.error(error); return; }
  candidateRows = data || [];
  renderCandidates();
}

function renderCandidates() {
  renderCardList({
    containerId: 'candidate-list',
    rows: candidateRows,
    fieldDefs: candidateFieldDefs,
    table: 'destination_candidates',
    titleKey: 'name',
    extraFooter: (row) => weatherFooterHtml(row),
  });
  // Wire name-blur -> geocode, and refresh buttons, after the generic render above.
  wireCandidateWeatherBehavior();
}

function weatherFooterHtml(row) {
  if (row.weather_fetched_at) {
    const fetchedDaysAgo = Math.floor((Date.now() - new Date(row.weather_fetched_at)) / 86400000);
    const label = row.weather_summary
      ? `${row.weather_summary} · water ${row.avg_water_temp_c ?? '—'}°C · air ${row.avg_air_temp_c ?? '—'}°C`
      : 'Conditions fetched';
    return `
      <span class="weather-readout ${fetchedDaysAgo > 14 ? 'stale' : ''}">${escapeHtml(label)} (${row.weather_is_forecast ? 'forecast' : 'typical'}, ${fetchedDaysAgo}d ago)</span>
      <button class="btn btn-ghost small btn-refresh-weather" data-id="${row.id}">Refresh conditions</button>`;
  }
  return `
    <span class="weather-readout stale">No conditions data yet</span>
    <button class="btn btn-ghost small btn-refresh-weather" data-id="${row.id}">Fetch conditions</button>`;
}

function wireCandidateWeatherBehavior() {
  const container = document.getElementById('candidate-list');

  // Auto-geocode: when the name field is saved and there's no lat/lng yet,
  // look up coordinates automatically so the user never has to know them.
  container.querySelectorAll('.card').forEach(cardEl => {
    const id = cardEl.dataset.id;
    const nameInput = cardEl.querySelector('[data-key="name"]');
    nameInput.addEventListener('blur', async () => {
      const row = candidateRows.find(r => r.id === id);
      if (row && nameInput.value && !row.lat && !row.lng) {
        await geocodeAndFetchWeather(row);
      }
    });
  });

  container.querySelectorAll('.btn-refresh-weather').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = candidateRows.find(r => r.id === btn.dataset.id);
      if (!row) return;
      if (!row.lat || !row.lng) {
        if (row.name) await geocodeAndFetchWeather(row);
        else { showToast('Add a name first'); return; }
      } else {
        await fetchAndCacheWeather(row);
      }
    });
  });
}

async function geocodeAndFetchWeather(row) {
  showToast('Looking up location…');
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(row.name)}&count=1&language=en&format=json`);
    const json = await res.json();
    if (!json.results || !json.results.length) {
      showToast('Location not found — enter lat/lng manually');
      return;
    }
    const { latitude, longitude } = json.results[0];
    await supabaseClient.from('destination_candidates').update({ lat: latitude, lng: longitude }).eq('id', row.id);
    row.lat = latitude;
    row.lng = longitude;
    await fetchAndCacheWeather(row);
    renderCandidates();
  } catch (err) {
    console.error(err);
    showToast('Lookup failed — check your connection');
  }
}

// Fetches "typical conditions" (same week last year) if the target date
// is far off, or a real forecast if it's within Open-Meteo's ~16-day
// forecast window. Results are cached on the row via weather_fetched_at
// so we don't re-call the API on every page load — only on explicit
// refresh, a changed date, or first fetch.
async function fetchAndCacheWeather(row) {
  if (!row.lat || !row.lng) { showToast('Needs coordinates first'); return; }
  showToast('Fetching conditions…');
  const targetDate = row.target_date ? new Date(row.target_date) : null;
  const daysOut = targetDate ? Math.ceil((targetDate - new Date()) / 86400000) : null;
  const isForecastWindow = daysOut !== null && daysOut >= 0 && daysOut <= 16;

  try {
    let airTemp = null, waterTemp = null, summary = '';

    if (isForecastWindow) {
      const dateStr = row.target_date;
      const air = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${row.lat}&longitude=${row.lng}&daily=temperature_2m_mean,precipitation_sum&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`).then(r => r.json());
      airTemp = air?.daily?.temperature_2m_mean?.[0] ?? null;
      const water = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${row.lat}&longitude=${row.lng}&hourly=sea_surface_temperature&start_date=${dateStr}&end_date=${dateStr}`).then(r => r.json());
      waterTemp = averageArray(water?.hourly?.sea_surface_temperature);
      summary = 'Forecast for your travel date';
    } else {
      // No real forecast that far out — use the same calendar week
      // from last year as a "typical conditions" estimate.
      const ref = targetDate ? new Date(targetDate) : new Date();
      ref.setFullYear(ref.getFullYear() - 1);
      const start = new Date(ref); start.setDate(start.getDate() - 3);
      const end = new Date(ref); end.setDate(end.getDate() + 3);
      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);

      const air = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${row.lat}&longitude=${row.lng}&daily=temperature_2m_mean,precipitation_sum&start_date=${startStr}&end_date=${endStr}&timezone=auto`).then(r => r.json());
      airTemp = averageArray(air?.daily?.temperature_2m_mean);
      try {
        const water = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${row.lat}&longitude=${row.lng}&hourly=sea_surface_temperature&start_date=${startStr}&end_date=${endStr}`).then(r => r.json());
        waterTemp = averageArray(water?.hourly?.sea_surface_temperature);
      } catch { waterTemp = null; }
      summary = 'Typical conditions (same week, last year)';
    }

    const patch = {
      avg_air_temp_c: airTemp !== null ? Math.round(airTemp * 10) / 10 : null,
      avg_water_temp_c: waterTemp !== null ? Math.round(waterTemp * 10) / 10 : null,
      weather_summary: summary,
      weather_is_forecast: isForecastWindow,
      weather_fetched_at: new Date().toISOString(),
    };
    await supabaseClient.from('destination_candidates').update(patch).eq('id', row.id);
    Object.assign(row, patch);
    renderCandidates();
    showToast('Conditions updated');
  } catch (err) {
    console.error(err);
    showToast('Could not fetch conditions — try again later');
  }
}

function averageArray(arr) {
  if (!arr || !arr.length) return null;
  const nums = arr.filter(v => typeof v === 'number');
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

document.getElementById('add-candidate-btn').addEventListener('click', async () => {
  const { data, error } = await supabase
    .from('destination_candidates')
    .insert({ trip_id: currentTripId, name: 'New destination', position: candidateRows.length })
    .select().single();
  if (error) { console.error(error); return; }
  candidateRows.push(data);
  renderCandidates();
});

// ---------------------------------------------------------
// 9. DIVE SHOPS
// ---------------------------------------------------------
let shopRows = [];
const shopFieldDefs = [
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: [
      { value: 'researching', label: 'Researching' },
      { value: 'contacted', label: 'Contacted' },
      { value: 'booked', label: 'Booked' },
      { value: 'confirmed', label: 'Confirmed' },
    ] },
  { key: 'website', label: 'Website', type: 'text' },
  { key: 'contact', label: 'Contact', type: 'text' },
  { key: 'cost', label: 'Cost', type: 'number', step: '0.01' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];
async function loadShops() {
  const { data, error } = await supabaseClient.from('dive_shops').select('*').eq('trip_id', currentTripId).order('position');
  if (error) { console.error(error); return; }
  shopRows = data || [];
  renderShops();
}
function renderShops() {
  renderCardList({ containerId: 'shop-list', rows: shopRows, fieldDefs: shopFieldDefs, table: 'dive_shops', titleKey: 'name' });
}
document.getElementById('add-shop-btn').addEventListener('click', async () => {
  const { data, error } = await supabase.from('dive_shops').insert({ trip_id: currentTripId, name: 'New Dive Shop', position: shopRows.length }).select().single();
  if (error) { console.error(error); return; }
  shopRows.push(data);
  renderShops();
});

// ---------------------------------------------------------
// 10. DIVE SITES
// ---------------------------------------------------------
let siteRows = [];
function siteFieldDefs() {
  return [
    { key: 'dive_shop_id', label: 'Dive shop', type: 'select', options: shopRows.map(s => ({ value: s.id, label: s.name })) },
    { key: 'target_date', label: 'Target date', type: 'date' },
    { key: 'max_depth_m', label: 'Max depth (m)', type: 'number', step: '0.1' },
    { key: 'tank_type', label: 'Tank', type: 'select', options: [
        { value: 'air', label: 'Air' }, { value: 'nitrox', label: 'Nitrox' },
      ] },
    { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  ];
}
async function loadSites() {
  const { data, error } = await supabaseClient.from('dive_sites').select('*').eq('trip_id', currentTripId).order('position');
  if (error) { console.error(error); return; }
  siteRows = data || [];
  renderSites();
}
function renderSites() {
  renderCardList({ containerId: 'site-list', rows: siteRows, fieldDefs: siteFieldDefs(), table: 'dive_sites', titleKey: 'name' });
}
document.getElementById('add-site-btn').addEventListener('click', async () => {
  const { data, error } = await supabaseClient.from('dive_sites').insert({ trip_id: currentTripId, name: 'New Dive Site', position: siteRows.length }).select().single();
  if (error) { console.error(error); return; }
  siteRows.push(data);
  renderSites();
});

// ---------------------------------------------------------
// 11. FLIGHTS
// ---------------------------------------------------------
let flightRows = [];
const flightFieldDefs = [
  { key: 'airline', label: 'Airline', type: 'text' },
  { key: 'flight_number', label: 'Flight #', type: 'text' },
  { key: 'departure_at', label: 'Departs', type: 'datetime-local' },
  { key: 'arrival_at', label: 'Arrives', type: 'datetime-local' },
  { key: 'confirmation_code', label: 'Confirmation #', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];
async function loadFlights() {
  const { data, error } = await supabaseClient.from('flights').select('*').eq('trip_id', currentTripId).order('position');
  if (error) { console.error(error); return; }
  flightRows = data || [];
  renderFlights();
}
function renderFlights() {
  renderCardList({ containerId: 'flight-list', rows: flightRows, fieldDefs: flightFieldDefs, table: 'flights', titleKey: 'airline' });
}
document.getElementById('add-flight-btn').addEventListener('click', async () => {
  const { data, error } = await supabaseClient.from('flights').insert({ trip_id: currentTripId, airline: 'New Flight', position: flightRows.length }).select().single();
  if (error) { console.error(error); return; }
  flightRows.push(data);
  renderFlights();
});

// ---------------------------------------------------------
// 12. ACCOMMODATIONS
// ---------------------------------------------------------
let stayRows = [];
const stayFieldDefs = [
  { key: 'check_in', label: 'Check in', type: 'date' },
  { key: 'check_out', label: 'Check out', type: 'date' },
  { key: 'has_fridge', label: 'Has a fridge', type: 'checkbox' },
  { key: 'confirmation_code', label: 'Confirmation #', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];
async function loadStays() {
  const { data, error } = await supabaseClient.from('accommodations').select('*').eq('trip_id', currentTripId).order('position');
  if (error) { console.error(error); return; }
  stayRows = data || [];
  renderStays();
}
function renderStays() {
  renderCardList({ containerId: 'stay-list', rows: stayRows, fieldDefs: stayFieldDefs, table: 'accommodations', titleKey: 'name' });
}
document.getElementById('add-stay-btn').addEventListener('click', async () => {
  const { data, error } = await supabaseClient.from('accommodations').insert({ trip_id: currentTripId, name: 'New Stay', position: stayRows.length }).select().single();
  if (error) { console.error(error); return; }
  stayRows.push(data);
  renderStays();
});

// ---------------------------------------------------------
// 13. GEAR LOCKER (personal — not trip-scoped)
// ---------------------------------------------------------
let gearRows = [];
const gearFieldDefs = [
  { key: 'size', label: 'Size / spec', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];
async function loadGear() {
  const { data, error } = await supabaseClient.from('gear_locker').select('*').eq('user_id', currentUser.id).order('position');
  if (error) { console.error(error); return; }
  gearRows = data || [];
  renderGear();
}
function renderGear() {
  renderCardList({ containerId: 'gear-list', rows: gearRows, fieldDefs: gearFieldDefs, table: 'gear_locker', titleKey: 'item' });
}
document.getElementById('add-gear-btn').addEventListener('click', async () => {
  const { data, error } = await supabaseClient.from('gear_locker').insert({ user_id: currentUser.id, item: 'New Item', position: gearRows.length }).select().single();
  if (error) { console.error(error); return; }
  gearRows.push(data);
  renderGear();
});

// ---------------------------------------------------------
// 14. CERTIFICATIONS (personal — not trip-scoped)
// ---------------------------------------------------------
let certRows = [];
const certFieldDefs = [
  { key: 'level', label: 'Level', type: 'text' },
  { key: 'cert_number', label: 'Cert #', type: 'text' },
  { key: 'issued_date', label: 'Issued', type: 'date' },
];
async function loadCerts() {
  const { data, error } = await supabaseClient.from('certifications').select('*').eq('user_id', currentUser.id).order('position');
  if (error) { console.error(error); return; }
  certRows = data || [];
  renderCerts();
}
function renderCerts() {
  renderCardList({ containerId: 'cert-list', rows: certRows, fieldDefs: certFieldDefs, table: 'certifications', titleKey: 'agency' });
}
document.getElementById('add-cert-btn').addEventListener('click', async () => {
  const { data, error } = await supabaseClient.from('certifications').insert({ user_id: currentUser.id, agency: 'New Certification', position: certRows.length }).select().single();
  if (error) { console.error(error); return; }
  certRows.push(data);
  renderCerts();
});

// ---------------------------------------------------------
// 15. UTIL
// ---------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

function wireStaticUI() {
  wireTabs();
  wireReadoutInputs();
  loadGear();
  loadCerts();
}

// ---------------------------------------------------------
// 16. BOOT
// ---------------------------------------------------------
checkExistingSession();
