/* =============================================
   WeatherScope – App Logic
   Sumber Data: BMKG (api.bmkg.go.id)
   Endpoint: /publik/prakiraan-cuaca?adm4={kode}
   Tidak memerlukan API Key.
   ============================================= */
'use strict';

// ─── BMKG API ─────────────────────────────────────────────────────────────────
const BMKG_API = 'https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=';
// Endpoint pencarian wilayah BMKG (digunakan untuk reverse geocode dari koordinat)
const BMKG_WILAYAH = 'https://api.bmkg.go.id/publik/wilayah?';

// ─── Database Kota Indonesia (adm4) ──────────────────────────────────────────
// CITIES database telah dihapus dan digantikan oleh fetch API dinamis dari wilayah.id

// ─── State ────────────────────────────────────────────────────────────────────
let isDark = localStorage.getItem('ws_theme') !== 'light';
let currentCityObj = null;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.classList.toggle('dark', isDark);
  $('moon-icon').classList.toggle('hidden', !isDark);
  $('sun-icon').classList.toggle('hidden',  isDark);
}
$('dark-toggle').addEventListener('click', () => {
  isDark = !isDark;
  localStorage.setItem('ws_theme', isDark ? 'dark' : 'light');
  applyTheme();
});
applyTheme();

// ─── Region Selector (wilayah.id) ─────────────────────────────────────────────
const selProv = $('sel-prov');
const selKab = $('sel-kab');
const selKec = $('sel-kec');
const btnCuaca = $('btn-lihat-cuaca');
let selectedRegion = { province: '', regency: '', district: '', adm4: '', name: '' };

async function fetchWilayah(url) {
  try {
    // Menggunakan proxy Vercel Serverless Function milik sendiri untuk menghindari blokir CORS
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.error('Gagal memuat wilayah', url);
    return [];
  }
}

async function loadProvinces() {
  const provs = await fetchWilayah('https://wilayah.id/api/provinces.json');
  selProv.innerHTML = '<option value="" class="text-slate-900">Pilih Provinsi...</option>';
  provs.forEach(p => {
    selProv.insertAdjacentHTML('beforeend', `<option value="${p.code}" class="text-slate-900">${p.name}</option>`);
  });
}

selProv.addEventListener('change', async (e) => {
  const code = e.target.value;
  selectedRegion.province = e.target.options[e.target.selectedIndex]?.text || '';
  
  selKab.innerHTML = '<option value="" class="text-slate-900">Pilih Kabupaten...</option>';
  selKab.disabled = true;
  selKec.innerHTML = '<option value="" class="text-slate-900">Pilih Kecamatan...</option>';
  selKec.disabled = true;
  btnCuaca.disabled = true;

  if (!code) return;
  const kabs = await fetchWilayah(`https://wilayah.id/api/regencies/${code}.json`);
  kabs.forEach(k => {
    selKab.insertAdjacentHTML('beforeend', `<option value="${k.code}" class="text-slate-900">${k.name}</option>`);
  });
  selKab.disabled = false;
});

selKab.addEventListener('change', async (e) => {
  const code = e.target.value;
  selectedRegion.regency = e.target.options[e.target.selectedIndex]?.text || '';
  
  selKec.innerHTML = '<option value="" class="text-slate-900">Pilih Kecamatan...</option>';
  selKec.disabled = true;
  btnCuaca.disabled = true;

  if (!code) return;
  const kecs = await fetchWilayah(`https://wilayah.id/api/districts/${code}.json`);
  kecs.forEach(k => {
    selKec.insertAdjacentHTML('beforeend', `<option value="${k.code}" class="text-slate-900">${k.name}</option>`);
  });
  selKec.disabled = false;
  btnCuaca.disabled = false; // Bisa fetch cuaca level kab
});

selKec.addEventListener('change', (e) => {
  selectedRegion.district = e.target.options[e.target.selectedIndex]?.text || '';
  // Tetap enable btnCuaca karena bisa fetch level mana saja (akan di resolve ke adm4)
});

btnCuaca.addEventListener('click', async () => {
  const provCode = selProv.value;
  const kabCode = selKab.value;
  const kecCode = selKec.value;
  if (!kabCode) return;

  btnCuaca.disabled = true;
  $('btn-spinner').classList.remove('hidden');
  $('btn-text').textContent = 'Mencari Wilayah...';

  // Jika kecamatan tidak dipilih, fetch kecamatan pertama dari kabupaten
  let targetKec = kecCode;
  if (!targetKec) {
    const kecs = await fetchWilayah(`https://wilayah.id/api/districts/${kabCode}.json`);
    if (kecs.length > 0) targetKec = kecs[0].code;
  }

  // Fetch kelurahan dari kecamatan untuk mendapatkan adm4 BMKG
  let adm4 = null;
  if (targetKec) {
    const kels = await fetchWilayah(`https://wilayah.id/api/villages/${targetKec}.json`);
    if (kels.length > 0) adm4 = kels[0].code;
  }

  $('btn-spinner').classList.add('hidden');
  $('btn-text').textContent = 'Lihat Cuaca';
  btnCuaca.disabled = false;

  if (!adm4) {
    alert('Data lokasi detail tidak ditemukan di wilayah.id.');
    return;
  }

  // Hitung timezone berdasar kode provinsi
  const pCode = parseInt(provCode, 10);
  let tz = 7; // default WIB
  if (pCode >= 81) tz = 9; // WIT
  else if ((pCode >= 51 && pCode <= 53) || (pCode >= 63 && pCode <= 76)) tz = 8; // WITA

  // Gunakan nama kecamatan jika dipilih, jika tidak nama kabupaten
  const displayName = kecCode ? selectedRegion.district : selectedRegion.regency;
  
  const cityObj = {
    name: displayName,
    regency: selectedRegion.regency,
    province: selectedRegion.province,
    adm4: adm4,
    tz: tz
  };
  
  fetchWeather(cityObj);
});

// Load province on start
loadProvinces();

// ─── Global function (called from HTML buttons) ───────────────────────────────
window.searchByAdm4 = function(adm4, name, province) {
  const pCode = parseInt(adm4.split('.')[0], 10);
  let tz = 7;
  if (pCode >= 81) tz = 9;
  else if ((pCode >= 51 && pCode <= 53) || (pCode >= 63 && pCode <= 76)) tz = 8;
  
  fetchWeather({ name, province, adm4, tz });
};

window.showWelcome = function() {
  $('loading').classList.add('hidden');   $('loading').classList.remove('flex');
  $('error-state').classList.add('hidden'); $('error-state').classList.remove('flex');
  $('weather-dashboard').classList.add('hidden');
  $('welcome-state').classList.remove('hidden');
  currentCityObj = null;
  // Reset background animation
  $('weather-bg').innerHTML = '';
};

// ─── Location Button ──────────────────────────────────────────────────────────
$('location-btn').addEventListener('click', () => {
  alert('Pencarian berbasis geolokasi dinonaktifkan sementara karena migrasi ke sistem wilayah API.');
});

// ─── UI State Helpers ─────────────────────────────────────────────────────────
function showLoading() {
  $('loading').classList.remove('hidden'); $('loading').classList.add('flex');
  $('error-state').classList.add('hidden'); $('error-state').classList.remove('flex');
  $('welcome-state').classList.add('hidden');
  $('weather-dashboard').classList.add('hidden');
}
function showError(msg) {
  $('loading').classList.add('hidden'); $('loading').classList.remove('flex');
  $('error-state').classList.remove('hidden'); $('error-state').classList.add('flex');
  $('error-msg').textContent = msg;
  $('welcome-state').classList.add('hidden');
  $('weather-dashboard').classList.add('hidden');
}
function showDashboard() {
  $('loading').classList.add('hidden'); $('loading').classList.remove('flex');
  $('error-state').classList.add('hidden'); $('error-state').classList.remove('flex');
  $('welcome-state').classList.add('hidden');
  $('weather-dashboard').classList.remove('hidden');
}

// ─── Fetch BMKG Data ──────────────────────────────────────────────────────────
async function fetchWeather(cityObj) {
  showLoading();
  currentCityObj = cityObj;
// searchInput.value = cityObj.name; // Dihapus karena fitur search manual diganti dropdown

  // Buat daftar variant ADM4 untuk dicoba jika kode utama gagal.
  // Format: PP.KK.KEC.KELVVVV — varian akhir berbeda (1001, 2001, 3001, 1002, ...)
  const base = cityObj.adm4.slice(0, cityObj.adm4.lastIndexOf('.'));
  const adm4Variants = [
    cityObj.adm4,
    `${base}.2001`, `${base}.3001`, `${base}.4001`,
    `${base}.1002`, `${base}.1003`,
  ];

  let lastErr = null;
  for (const adm4 of adm4Variants) {
    try {
      const res = await fetch(`${BMKG_API}${adm4}`);
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status} (adm4: ${adm4})`); continue; }
      const json = await res.json();
      // Validasi data tidak kosong
      const cuacaOk = json.data && json.data.length > 0 &&
                      json.data[0].cuaca && json.data[0].cuaca.length > 0;
      if (!cuacaOk) { lastErr = new Error(`Data kosong (adm4: ${adm4})`); continue; }
      // Berhasil — render dan selesai
      processAndRender(json, cityObj);
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  console.error('Semua varian ADM4 gagal:', lastErr);
  showError(`Data untuk "${cityObj.name}" tidak ditemukan di server BMKG. Coba kota lain yang berdekatan.`);
}

// ─── Process BMKG JSON ────────────────────────────────────────────────────────
function processAndRender(json, cityObj) {
  // BMKG response: { lokasi: {...}, data: [{ cuaca: [[{...}],[{...}],...], lokasi: {...} }] }
  const lokasi = json.lokasi || {};
  const dataArr = json.data || [];

  // Flatten cuaca: data[0].cuaca is an array of arrays (one sub-array per day)
  let cuacaList = [];
  dataArr.forEach(d => {
    const cuacaGroup = d.cuaca || [];
    cuacaGroup.forEach(group => {
      if (Array.isArray(group)) {
        cuacaList = cuacaList.concat(group);
      } else if (group && typeof group === 'object') {
        cuacaList.push(group);
      }
    });
  });

  if (!cuacaList.length) {
    showError(`Data cuaca untuk ${cityObj.name} tidak tersedia saat ini.`);
    return;
  }

  // Normalize field names: BMKG uses 'datetime' (UTC) and 'local_datetime'
  cuacaList = cuacaList.map(item => ({
    ...item,
    // Ensure consistent UTC datetime
    _utc: new Date(item.utc_datetime || item.datetime || item.local_datetime),
    // Visibility: 'vs' is numeric meters, 'vs_text' is human-readable
    visibility_km: item.vs_text || (item.vs ? (item.vs / 1000).toFixed(1) + ' km' : '—'),
    // Wind degree: field is wd_deg
    wind_deg: item.wd_deg ?? item.wd_deg ?? null,
  }));

  // Sort by UTC
  cuacaList.sort((a, b) => a._utc - b._utc);

  // Find current (closest to now in UTC)
  const nowMs = Date.now();
  let curIdx = 0, minDiff = Infinity;
  cuacaList.forEach((item, i) => {
    const diff = Math.abs(item._utc.getTime() - nowMs);
    if (diff < minDiff) { minDiff = diff; curIdx = i; }
  });

  const current = cuacaList[curIdx];
  const hourly  = cuacaList.slice(curIdx, curIdx + 9);
  const all     = cuacaList;

  // Group by local date (YYYY-MM-DD from local_datetime string)
  const dayMap = {};
  all.forEach(item => {
    const dayKey = (item.local_datetime || '').slice(0, 10);
    if (!dayKey) return;
    if (!dayMap[dayKey]) dayMap[dayKey] = [];
    dayMap[dayKey].push(item);
  });

  const dailyKeys = Object.keys(dayMap).sort().slice(0, 3);
  const daily = dailyKeys.map(key => {
    const items = dayMap[key];
    const temps = items.map(i => i.t).filter(t => t != null);
    const mid = items[Math.floor(items.length / 2)];
    return { dateKey: key, tmax: Math.max(...temps), tmin: Math.min(...temps), rep: mid, items };
  });

  // Use lat/lon from API response (more accurate than approximation)
  const lat = parseFloat(lokasi.lat) || approxLat(cityObj.tz);
  const lon = parseFloat(lokasi.lon) || approxLon(cityObj.tz);
  const sunTimes = calcSunriseSunset(lat, lon, cityObj.tz);

  renderDashboard({ lokasi: { ...lokasi, cityObj }, current, hourly, daily, sunTimes, lat, lon });
}

// Approximate lat/lon by timezone for sunrise calc fallback
function approxLat(tz) { return tz === 7 ? -6.2 : tz === 8 ? -8.5 : -4.5; }
function approxLon(tz) { return tz === 7 ? 107 : tz === 8 ? 115 : 131; }

// ─── Render Dashboard ─────────────────────────────────────────────────────────
function renderDashboard({ lokasi, current, hourly, daily, sunTimes, lat, lon }) {
  const cityObj = lokasi.cityObj;
  const weatherCode = getWeatherCode(current);
  const isDay = checkIsDay(current, sunTimes);

  // Background animation
  setWeatherBg(weatherCode, isDay);

  // Hero gradient
  $('hero-gradient').style.background = getGradient(weatherCode, isDay);

  // City info
  $('city-name').textContent = cityObj.name;
  $('city-province').textContent = cityObj.province;
  // Breadcrumb di tombol back
  const bc = $('breadcrumb-city');
  if (bc) {
    if (cityObj.regency && cityObj.regency !== cityObj.name) {
      bc.textContent = `${cityObj.name}, ${cityObj.regency}, ${cityObj.province}`;
    } else {
      bc.textContent = `${cityObj.name}, ${cityObj.province}`;
    }
  }

  // Date
  const localDt = new Date(current.local_datetime || current.utc_datetime);
  const DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  $('current-date').textContent = `${DAYS[localDt.getDay()]}, ${localDt.getDate()} ${MONTHS[localDt.getMonth()]} ${localDt.getFullYear()} · ${cityObj.tz === 7 ? 'WIB' : cityObj.tz === 8 ? 'WITA' : 'WIT'}`;

  // Temp & weather
  const temp = current.t ?? null;
  $('weather-icon-main').textContent = getBMKGEmoji(weatherCode, isDay);
  $('temp-main').textContent = temp != null ? `${Math.round(temp)}°` : '—';

  // Feels like (heat index)
  if (temp != null && current.hu != null) {
    const hi = calcHeatIndex(temp, current.hu);
    $('feels-like').textContent = `Terasa seperti ${Math.round(hi)}°C`;
  } else {
    $('feels-like').textContent = '';
  }

  $('weather-desc').textContent = current.weather_desc || '—';

  // Max / min from daily[0]
  const todayData = daily[0];
  $('temp-max').textContent = todayData ? `${Math.round(todayData.tmax)}°C` : '—';
  $('temp-min').textContent = todayData ? `${Math.round(todayData.tmin)}°C` : '—';

  // Last updated (show local time from local_datetime field)
  const localTimeStr = (current.local_datetime || '').slice(11, 16) || localDt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  $('last-updated').textContent = localTimeStr;

  // Stats
  $('humidity-val').textContent    = current.hu != null ? `${current.hu}%` : '—';
  $('wind-val').textContent        = current.ws != null ? `${Math.round(current.ws * 10) / 10} km/j` : '—';
  $('visibility-val').textContent  = current.vs_text || (current.vs ? `${(current.vs/1000).toFixed(1)} km` : '—');
  $('cloud-cover-val').textContent = current.tcc != null ? `${current.tcc}%` : '—';
  $('sunrise-val').textContent     = sunTimes.sunrise;
  $('sunset-val').textContent      = sunTimes.sunset;

  // Detail cards
  const tcc = current.tcc ?? 0;
  $('cloud-val').textContent = `${tcc}%`;
  setTimeout(() => { $('cloud-bar').style.width = `${tcc}%`; }, 100);

  const hu = current.hu ?? 0;
  $('hum-detail').textContent = `${hu}%`;
  setTimeout(() => { $('hum-bar').style.width = `${hu}%`; }, 100);

  if (temp != null && current.hu != null) {
    $('dew-val').textContent = `${calcDewPoint(temp, current.hu)}°C`;
  } else {
    $('dew-val').textContent = '—';
  }

  // Wind direction: BMKG uses 'wd' (cardinal like 'SE') and 'wd_deg' (numeric)
  const wd = current.wd || '—';
  const wdDeg = current.wd_deg ?? wdCardinalToDeg(wd);
  $('wind-dir-val').textContent  = wd;
  $('wind-dir-full').textContent = cardinalToIndonesian(wd);
  setTimeout(() => {
    $('wind-arrow').style.transform = `rotate(${wdDeg}deg) translateY(-12px)`;
  }, 200);

  // Wind gauge (ws in km/h from BMKG)
  const ws = current.ws ?? 0;
  const maxWind = 80;
  const windPct = Math.min(ws / maxWind, 1);
  $('wind-gauge-val').textContent = Math.round(ws * 10) / 10;
  setTimeout(() => {
    $('wind-gauge-circle').style.strokeDashoffset = 251.2 * (1 - windPct);
  }, 300);

  // Sections
  renderHourly(hourly, isDay);
  renderDaily(daily);
  renderHumidityChart(hourly);
  renderDetailTable(hourly);

  showDashboard();
}

// ─── Hourly ───────────────────────────────────────────────────────────────────
function renderHourly(items, baseIsDay) {
  const el = $('hourly-list');
  el.innerHTML = '';
  items.forEach((item, i) => {
    const code = getWeatherCode(item);
    // Use local_datetime string slice for display (avoids timezone conversion issues)
    const localStr = item.local_datetime || '';
    const timeStr = i === 0 ? 'Kini' : localStr.slice(11, 16) || new Date(item._utc).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const day = document.createElement('div');
    day.className = `hourly-item${i === 0 ? ' active' : ''}`;
    day.innerHTML = `
      <div class="hourly-time">${timeStr}</div>
      <div class="hourly-icon">${getBMKGEmoji(code, true)}</div>
      <div class="hourly-temp">${item.t != null ? Math.round(item.t) + '°' : '—'}</div>
      <div class="hourly-hum">💧 ${item.hu ?? '—'}%</div>
    `;
    el.appendChild(day);
  });
}

// ─── Daily ────────────────────────────────────────────────────────────────────
function renderDaily(days) {
  const el = $('daily-list');
  el.innerHTML = '';
  const DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

  days.forEach((dayData, i) => {
    const code = getWeatherCode(dayData.rep);
    // Parse day of week from local_datetime string to avoid timezone issues
    const localStr = dayData.rep.local_datetime || dayData.dateKey || '';
    const localDateParts = localStr.slice(0, 10).split('-').map(Number);
    const dt = localDateParts.length === 3 ? new Date(localDateParts[0], localDateParts[1]-1, localDateParts[2]) : new Date(dayData.rep._utc);
    const dayName = i === 0 ? 'Hari ini' : DAYS[dt.getDay()];

    // Avg humidity & wind
    const avgHu = Math.round(dayData.items.reduce((s, x) => s + (x.hu ?? 0), 0) / dayData.items.length);
    const avgWs = Math.round(dayData.items.reduce((s, x) => s + (x.ws ?? 0), 0) / dayData.items.length);

    const div = document.createElement('div');
    div.className = 'daily-item';
    div.innerHTML = `
      <div class="daily-day">${dayName}</div>
      <div class="daily-icon">${getBMKGEmoji(code, true)}</div>
      <div class="daily-desc">${dayData.rep.weather_desc || '—'}</div>
      <div class="daily-temps">
        <span class="daily-high">${Math.round(dayData.tmax)}°</span>
        <span class="daily-low">${Math.round(dayData.tmin)}°</span>
      </div>
      <div class="daily-stats">
        <div class="daily-stat"><span>💧 Kelembapan</span><span>${avgHu}%</span></div>
        <div class="daily-stat"><span>💨 Angin</span><span>${avgWs} km/j</span></div>
      </div>
    `;
    el.appendChild(div);
  });
}

// ─── Humidity Chart ───────────────────────────────────────────────────────────
function renderHumidityChart(items) {
  const chart  = $('humidity-chart');
  const labels = $('humidity-labels');
  chart.innerHTML = ''; labels.innerHTML = '';

  items.forEach(item => {
    const pct = (item.hu ?? 0) / 100;
    const bc  = document.createElement('div');
    bc.className = 'hum-bar-item';
    const bar = document.createElement('div');
    bar.className = 'hum-bar-fill';
    bar.style.height = '0px';
    bc.appendChild(bar);
    chart.appendChild(bc);

    const lc = document.createElement('div');
    lc.className = 'hum-bar-item';
    // Use local_datetime string slice to avoid timezone issues
    const localStr = item.local_datetime || '';
    const timeLabel = localStr.slice(11, 16) || '';
    lc.innerHTML = `<div class="hum-bar-label">${timeLabel}</div>`;
    labels.appendChild(lc);

    setTimeout(() => { bar.style.height = `${pct * 92}px`; }, 200);
  });
}

// ─── Detail Table ─────────────────────────────────────────────────────────────
function renderDetailTable(items) {
  const tbody = $('detail-tbody');
  tbody.innerHTML = '';

  items.forEach((item, i) => {
    const code = getWeatherCode(item);
    // Use local_datetime string for display to avoid browser timezone issues
    const localStr = item.local_datetime || '';
    const datePart = localStr.slice(0, 10); // YYYY-MM-DD
    const timePart = localStr.slice(11, 16); // HH:MM
    const dp = datePart.split('-');
    const DAYS_SHORT = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    let timeStr = timePart;
    if (dp.length === 3) {
      const d = new Date(+dp[0], +dp[1]-1, +dp[2]);
      timeStr = `${DAYS_SHORT[d.getDay()]} ${dp[2]} ${MONTHS_SHORT[+dp[1]-1]}, ${timePart}`;
    }
    const visDisplay = item.vs_text || (item.vs ? `${(item.vs/1000).toFixed(1)} km` : '—');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-time">${timeStr}</td>
      <td><span>${getBMKGEmoji(code, true)}</span> <span class="text-white/60 text-xs">${item.weather_desc || '—'}</span></td>
      <td class="td-temp td-right">${item.t != null ? Math.round(item.t) + '°C' : '—'}</td>
      <td class="td-right">${item.hu != null ? item.hu + '%' : '—'}</td>
      <td class="td-right">${item.ws != null ? Math.round(item.ws*10)/10 + ' km/j ' + (item.wd||'') : '—'}</td>
      <td class="td-right">${item.tcc != null ? item.tcc + '%' : '—'}</td>
      <td class="td-right">${visDisplay}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Weather Background ───────────────────────────────────────────────────────
const weatherBg = $('weather-bg');

function setWeatherBg(code, isDay) {
  weatherBg.innerHTML = '';
  if (code === 95 || code === 97)           { addRain(50); addLightning(); }
  else if (code >= 60 && code <= 63)        addRain(code >= 63 ? 80 : code === 61 ? 50 : 25);
  else if (code === 80)                     addRain(30, true);
  else if (code >= 600 && code <= 699)      addSnow();
  else if (code === 45 || code === 5 || code === 10) addFog();
  else if (code === 0 && isDay)             addSunRays();
  else if (code === 1 || code === 2)        addClouds(false);
  else if (code >= 3)                       addClouds(true);
}

function addRain(count = 50, light = false) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'rain-drop';
    el.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*-100}%;height:${light ? 8+Math.random()*8 : 15+Math.random()*25}px;opacity:${(light?0.3:0.45)+Math.random()*0.35};--dur:${0.5+Math.random()*0.7}s;--delay:${Math.random()*2}s`;
    weatherBg.appendChild(el);
  }
}
function addLightning() {
  for (let i = 0; i < 3; i++) {
    const el = document.createElement('div');
    el.className = 'lightning-flash';
    el.style.setProperty('--delay', `${i * 1.5}s`);
    weatherBg.appendChild(el);
  }
}
function addSnow() {
  ['❄','❅','❆','·'].forEach((f, fi) => {
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'snow-flake';
      el.textContent = f;
      el.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*-50}%;--size:${8+Math.random()*14}px;--dur:${3+Math.random()*5}s;--delay:${Math.random()*5+fi}s`;
      weatherBg.appendChild(el);
    }
  });
}
function addFog() {
  for (let i = 0; i < 5; i++) {
    const el = document.createElement('div');
    el.className = 'cloud-drift';
    el.textContent = '☁';
    el.style.cssText = `left:${Math.random()*110-5}%;top:${10+i*15}%;--size:${90+Math.random()*100}px;--delay:${i*1.8}s;--opacity:0.07`;
    weatherBg.appendChild(el);
  }
}
function addSunRays() {
  const c = document.createElement('div');
  c.style.cssText = 'position:absolute;top:-15%;right:-5%;width:55vw;height:70vh;background:radial-gradient(ellipse at top right,rgba(251,191,36,0.07) 0%,transparent 70%);pointer-events:none;';
  weatherBg.appendChild(c);
}
function addClouds(heavy = false) {
  const n = heavy ? 7 : 3;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'cloud-drift';
    el.textContent = '☁';
    el.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*35}%;--size:${50+Math.random()*80}px;--delay:${i*1.5}s;--opacity:${heavy?0.12:0.1}`;
    weatherBg.appendChild(el);
  }
}

// ─── BMKG Weather Code Mapping ────────────────────────────────────────────────
// BMKG codes: 0=Cerah, 1-2=Cerah Berawan, 3=Berawan, 4=Berawan Tebal,
// 5=Udara Kabur, 10=Asap, 45=Kabut, 60=Hujan Ringan, 61=Hujan Sedang,
// 63=Hujan Lebat, 80=Hujan Lokal, 95=Hujan Petir, 97=Hujan Petir Lebat

function getWeatherCode(item) {
  if (item == null) return 0;
  // BMKG API v2 returns numeric 'weather' field (0=Cerah, 1=Cerah Berawan, etc.)
  if (item.weather != null && !isNaN(parseInt(item.weather))) return parseInt(item.weather);
  // Fallback: map from description string
  return descToCode(item.weather_desc || '');
}

function descToCode(desc) {
  if (!desc) return 0;
  const d = desc.toLowerCase();
  if (d.includes('petir'))          return 95;
  if (d.includes('lebat'))          return 63;
  if (d.includes('sedang') && d.includes('hujan')) return 61;
  if (d.includes('ringan') && d.includes('hujan')) return 60;
  if (d.includes('hujan lokal'))    return 80;
  if (d.includes('hujan'))          return 61;
  if (d.includes('kabut'))          return 45;
  if (d.includes('asap'))           return 10;
  if (d.includes('kabur'))          return 5;
  if (d.includes('tebal'))          return 4;
  if (d.includes('berawan') && !d.includes('cerah')) return 3;
  if (d.includes('cerah berawan'))  return 1;
  if (d.includes('cerah'))         return 0;
  return 3;
}

function getBMKGEmoji(code, isDay = true) {
  // BMKG Codes: 0=Cerah, 1=Cerah Berawan, 2=Cerah Berawan, 3=Berawan,
  // 4=Berawan Tebal, 5=Udara Kabur, 10=Asap, 45=Kabut,
  // 60=Hujan Ringan, 61=Hujan Sedang, 63=Hujan Lebat,
  // 80=Hujan Lokal, 95=Hujan Petir, 97=Hujan Petir Lebat
  switch (code) {
    case 0:  return isDay ? '☀️' : '🌙';
    case 1:  return isDay ? '🌤️' : '🌤️';
    case 2:  return isDay ? '⛅' : '⛅';
    case 3:  return '☁️';
    case 4:  return '☁️';
    case 5:  return '🌫️';
    case 10: return '💨';
    case 45: return '🌫️';
    case 60: return isDay ? '🌦️' : '🌧️';
    case 61: return '🌧️';
    case 63: return '🌧️';
    case 80: return '🌦️';
    case 95: return '⛈️';
    case 97: return '⛈️';
    default: return isDay ? '🌤️' : '🌙';
  }
}

function getGradient(code, isDay = true) {
  if (code === 95 || code === 97)
    return 'linear-gradient(135deg,#0d1117 0%,#161b22 40%,#0d2137 100%)';
  if (code >= 60 && code <= 80)
    return 'linear-gradient(135deg,#1a2744 0%,#243b6e 100%)';
  if (code >= 3 && code <= 4)
    return 'linear-gradient(135deg,#243447 0%,#3d5a7a 100%)';
  if (code === 5 || code === 10 || code === 45)
    return 'linear-gradient(135deg,#2d3748 0%,#4a5568 100%)';
  if (code === 0 && isDay)
    return 'linear-gradient(135deg,#1565c0 0%,#0288d1 45%,#00838f 100%)';
  if (code <= 2 && isDay)
    return 'linear-gradient(135deg,#1976d2 0%,#0288d1 100%)';
  // Night
  return 'linear-gradient(135deg,#0d1b2a 0%,#1a2f45 100%)';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function checkIsDay(item, sunTimes) {
  const localDt = new Date(item.local_datetime || item.utc_datetime);
  const h = localDt.getHours() + localDt.getMinutes() / 60;
  const srParts = sunTimes.sunrise.split(':').map(Number);
  const ssParts = sunTimes.sunset.split(':').map(Number);
  const sr = srParts[0] + srParts[1] / 60;
  const ss = ssParts[0] + ssParts[1] / 60;
  return h >= sr && h < ss;
}

function calcHeatIndex(T_C, RH) {
  if (T_C < 26) return T_C; // Heat index only meaningful in tropical heat
  const T = T_C * 9 / 5 + 32;
  const HI = -42.379 + 2.04901523*T + 10.14333127*RH
    - 0.22475541*T*RH - 0.00683783*T*T - 0.05391553*RH*RH
    + 0.00122874*T*T*RH + 0.00085282*T*RH*RH - 0.00000199*T*T*RH*RH;
  return (HI - 32) * 5 / 9;
}

function calcDewPoint(T_C, RH) {
  const a = 17.625, b = 243.04;
  const alpha = Math.log(RH / 100) + (a * T_C) / (b + T_C);
  return Math.round((b * alpha) / (a - alpha));
}

function calcSunriseSunset(lat, lon, tz) {
  const now = new Date();
  const D2R = Math.PI / 180;
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const B = 2 * Math.PI * (dayOfYear - 1) / 365;
  const decl = 0.006918 - 0.399912*Math.cos(B) + 0.070257*Math.sin(B)
             - 0.006758*Math.cos(2*B) + 0.000907*Math.sin(2*B);
  const eqTime = 229.18 * (0.000075 + 0.001868*Math.cos(B) - 0.032077*Math.sin(B)
               - 0.014615*Math.cos(2*B) - 0.04089*Math.sin(2*B));
  const cosHA = -Math.tan(lat * D2R) * Math.tan(decl);
  const HA = Math.acos(Math.max(-1, Math.min(1, cosHA))) / D2R;
  const srMinsUTC = 720 - 4 * (lon + HA) - eqTime;
  const ssMinsUTC = 720 - 4 * (lon - HA) - eqTime;
  const toLocalMins = m => m + tz * 60;

  function fmt(m) {
    const total = ((toLocalMins(m) % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60), mi = Math.floor(total % 60);
    return `${h.toString().padStart(2,'0')}:${mi.toString().padStart(2,'0')}`;
  }
  return { sunrise: fmt(srMinsUTC), sunset: fmt(ssMinsUTC) };
}

function wdCardinalToDeg(wd) {
  const map = { N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5,
                S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5,
                // Indonesian
                U:0, TL:45, T:90, TG:135, SL:157.5, BD:225, B:270, BL:315 };
  return map[wd?.toUpperCase()] ?? 0;
}

function cardinalToIndonesian(wd) {
  const map = { N:'Utara', NE:'Timur Laut', E:'Timur', SE:'Tenggara',
                S:'Selatan', SW:'Barat Daya', W:'Barat', NW:'Barat Laut',
                NNE:'Utara Timur Laut', ENE:'Timur Timur Laut',
                ESE:'Timur Tenggara', SSE:'Selatan Tenggara',
                SSW:'Selatan Barat Daya', WSW:'Barat Barat Daya',
                WNW:'Barat Barat Laut', NNW:'Utara Barat Laut',
                U:'Utara', TL:'Timur Laut', T:'Timur', TG:'Tenggara',
                SL:'Tenggara', BD:'Barat Daya', B:'Barat', BL:'Barat Laut' };
  return map[wd?.toUpperCase()] || wd || '—';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
showWelcome();
