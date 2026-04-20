// ── 1. Global State Storage ───────────────────────────────────────────
const store = {
  mq2: 0,
  mq135: 0,
  mq2History: [],
  mq135History: [],
  sparkMQ2: Array(30).fill(0),
  sparkMQ135: Array(30).fill(0),
  records: [],
  totalReads: 0,
  sessionStart: Date.now(),
  lastDataTime: Date.now(), // Tracks the last time Server sent data
  
  // New Threshold & Alert State
  warnThresh: 400,
  dangerThresh: 1000,
  cooldown: 15,
  lastAlertTime: 0,
  alertsFired: 0,
  alertsEnabled: true
};

let activeFSSensor = null;

// ── 2. Socket.io Integration (Replaces Direct Firebase) ───────────────
const socket = io();

socket.on('sensorUpdate', (data) => {
  if (data) {
    // Read the exact keys sent by your ESP32 Arduino code
    const mq2 = data.mq2_ppm || 0;
    const mq135 = data.mq135_ppm || 0;
    
    console.log("📡 Socket Update Received:", data);
    processSensorData(mq2, mq135);
  }
});

// ── 3. Data Processing Engine ─────────────────────────────────────────
function processSensorData(mq2, mq135) {
  store.lastDataTime = Date.now(); // Update connection heartbeat
  store.mq2 = mq2;
  store.mq135 = mq135;
  
  store.mq2History.push(mq2);
  store.mq135History.push(mq135);
  if(store.mq2History.length > 60) store.mq2History.shift();
  if(store.mq135History.length > 60) store.mq135History.shift();
  
  store.sparkMQ2.push(mq2);
  store.sparkMQ2.shift();
  store.sparkMQ135.push(mq135);
  store.sparkMQ135.shift();

  store.records.unshift({sensor: 'MQ2', value: mq2, ts: Date.now()});
  store.records.unshift({sensor: 'MQ135', value: mq135, ts: Date.now()});
  if(store.records.length > 100) store.records.splice(100); 

  store.totalReads += 2;

  // Fire UI Updates
  updateSensor('mq2', mq2);
  updateSensor('mq135', mq135);
  updateAQI(mq2, mq135);
  updateStats('mq2', store.mq2History);
  updateStats('mq135', store.mq135History);
  drawSparkline('spark-mq2', store.sparkMQ2, '#63c8ff');
  drawSparkline('spark-mq135', store.sparkMQ135, '#a78bfa');
  drawHistoryChart(); 
  renderRecords();
  updateSystemStats();
  
  // Process Alerts & UI Health changes
  checkAlerts(mq2, mq135);
  
  // Update Full-Screen view if it is currently open
  if (activeFSSensor) updateFSView();
}

// ── 4. Visual UI Updaters (Gauges & Charts) ───────────────────────────
function updateSensor(id, val) {
  const valEl = document.getElementById(`${id}-val`);
  if (valEl) valEl.innerText = val;

  const fillEl = document.getElementById(`${id}-fill`);
  if (fillEl) {
    const maxVal = 1400; 
    const pct = Math.min(val / maxVal, 1);
    const circumference = 2 * Math.PI * 80; 
    fillEl.style.strokeDasharray = `${circumference} ${circumference}`;
    fillEl.style.strokeDashoffset = circumference - (pct * circumference);
  }
}

function updateStats(id, history) {
  if (history.length === 0) return;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const avg = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
  
  if(document.getElementById(`${id}-min`)) document.getElementById(`${id}-min`).innerText = min;
  if(document.getElementById(`${id}-max`)) document.getElementById(`${id}-max`).innerText = max;
  if(document.getElementById(`${id}-avg`)) document.getElementById(`${id}-avg`).innerText = avg;
}

function updateAQI(mq2, mq135) {
  const aqi = Math.max(mq2, mq135); 
  const scoreEl = document.getElementById('aqi-score');
  if (scoreEl) scoreEl.innerText = aqi;

  const marker = document.getElementById('aqi-marker');
  if (marker) {
    const pct = Math.min((aqi / 1400) * 100, 100);
    marker.style.left = `${pct}%`;
  }
}

function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  
  const max = 1400;
  data.forEach((val, i) => {
    const x = (i / (data.length - 1)) * canvas.width;
    const y = canvas.height - (val / max) * canvas.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawHistoryChart() {
  const canvas = document.getElementById('history-canvas');
  if (!canvas) return;
  
  canvas.width = canvas.parentElement.clientWidth || 800;
  canvas.height = 200; 
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (store.mq2History.length === 0) return;
  
  const maxVal = 1400; 
  const maxPoints = 60;
  const step = canvas.width / (maxPoints - 1);
  
  function drawLine(data, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    
    const offset = maxPoints - data.length; 
    
    data.forEach((val, i) => {
      const x = (i + offset) * step;
      const y = canvas.height - (val / maxVal) * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  
  drawLine(store.mq135History, '#a78bfa'); 
  drawLine(store.mq2History, '#63c8ff');  
}

function renderRecords() {
  const body = document.getElementById('records-body');
  if (!body || store.records.length === 0) return;

  body.innerHTML = store.records.slice(0, 10).map(r => `
    <div style="display:flex; justify-content:space-between; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: 'Space Mono', monospace; font-size: 14px;">
      <span style="color: #8892b0;">${new Date(r.ts).toLocaleTimeString()}</span>
      <span style="color: ${r.sensor === 'MQ2' ? '#63c8ff' : '#a78bfa'}; font-weight: bold;">${r.sensor}</span>
      <span style="color: #e2e8f0;">${r.value} ppm</span>
    </div>
  `).join('');
}

function updateSystemStats() {
  const readsEl = document.getElementById('stat-reads');
  if (readsEl) readsEl.innerText = store.totalReads;
  
  const peakEl = document.getElementById('stat-peak');
  const allHistory = [...store.mq2History, ...store.mq135History];
  if (peakEl && allHistory.length > 0) {
    peakEl.innerText = Math.max(...allHistory);
  }
}

function updateUptime() {
  const uptimeEl = document.getElementById('stat-uptime');
  if (!uptimeEl) return;
  
  const diff = Math.floor((Date.now() - store.sessionStart) / 1000);
  const m = Math.floor(diff / 60).toString().padStart(2, '0');
  const s = (diff % 60).toString().padStart(2, '0');
  uptimeEl.innerText = `${m}:${s}`;
}

// ── 5. Status & Alert Logic ───────────────────────────────────────────
function checkAlerts(mq2, mq135) {
  const maxVal = Math.max(mq2, mq135);
  let status = 'safe';
  
  if (maxVal >= store.dangerThresh) status = 'danger';
  else if (maxVal >= store.warnThresh) status = 'warn';

  updateStatusUI('mq2', mq2);
  updateStatusUI('mq135', mq135);
  updateAQIStatus(maxVal, status);

  if (status !== 'safe' && store.alertsEnabled) {
    const now = Date.now();
    if (now - store.lastAlertTime > store.cooldown * 1000) {
      triggerBannerAlert(status, maxVal);
      store.lastAlertTime = now;
      store.alertsFired++;
      const statAlerts = document.getElementById('stat-alerts');
      if (statAlerts) statAlerts.innerText = store.alertsFired;
    }
  }
}

function updateStatusUI(id, val) {
  let status = 'safe';
  let text = 'Safe';
  
  if (val >= store.dangerThresh) { status = 'danger'; text = 'Danger'; }
  else if (val >= store.warnThresh) { status = 'warn'; text = 'Warning'; }
  
  const chip = document.getElementById(`chip-${id}`);
  if (chip) {
    chip.className = `chip-value ${status}`;
    chip.innerText = text;
  }
  
  const badge = document.getElementById(`${id}-badge`);
  if (badge) {
    badge.className = `status-badge ${status}`;
    badge.innerText = text.toUpperCase();
  }
}

function updateAQIStatus(maxVal, status) {
  const chip = document.getElementById('chip-aqi');
  const textEl = document.getElementById('aqi-status-text');
  
  let text = 'Good';
  if (status === 'warn') text = 'Moderate';
  if (status === 'danger') text = 'Hazardous';

  if (chip) {
    chip.className = `chip-value ${status}`;
    chip.innerText = text;
  }
  
  if (textEl) {
    textEl.innerText = `Current AQI is ${text} (${maxVal} ppm)`;
    textEl.style.color = status === 'danger' ? '#ef4444' : (status === 'warn' ? '#f59e0b' : '#10b981');
  }
}

function updateHealthBars() {
  const isConnected = (Date.now() - store.lastDataTime) < 15000; 
  
  const val1 = isConnected ? Math.floor(Math.random() * 3) + 98 : 0;
  const val2 = isConnected ? Math.floor(Math.random() * 3) + 98 : 0;
  
  const h1 = document.getElementById('mq2-health-pct');
  const b1 = document.getElementById('mq2-health-bar');
  if(h1 && b1) { h1.innerText = val1 + '%'; b1.style.width = val1 + '%'; }
  
  const h2 = document.getElementById('mq135-health-pct');
  const b2 = document.getElementById('mq135-health-bar');
  if(h2 && b2) { h2.innerText = val2 + '%'; b2.style.width = val2 + '%'; }
}

// ── 6. UI Interaction & Modals ────────────────────────────────────────
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const navTarget = document.getElementById('nav-' + pageId);
  if (navTarget) navTarget.classList.add('active');
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
  
  const nav = document.getElementById('mobile-nav');
  const ham = document.getElementById('hamburger');
  if (nav) nav.classList.remove('open');
  if (ham) ham.classList.remove('open');
}

function toggleMobileMenu() {
  const nav = document.getElementById('mobile-nav');
  const ham = document.getElementById('hamburger');
  if (nav) nav.classList.toggle('open');
  if (ham) ham.classList.toggle('open');
}

function openModal() {
  const modal = document.getElementById('threshold-modal');
  if (modal) modal.style.display = 'flex'; 
}

function closeModal() {
  const modal = document.getElementById('threshold-modal');
  if (modal) modal.style.display = 'none';
}

function saveThresholds() {
  store.warnThresh = parseInt(document.getElementById('thresh-warn').value) || 400;
  store.dangerThresh = parseInt(document.getElementById('thresh-danger').value) || 1000;
  store.cooldown = parseInt(document.getElementById('thresh-cooldown').value) || 15;
  
  document.getElementById('lbl-warn-mq2').innerText = store.warnThresh;
  document.getElementById('lbl-danger-mq2').innerText = store.dangerThresh;
  document.getElementById('lbl-warn-mq135').innerText = store.warnThresh;
  document.getElementById('lbl-danger-mq135').innerText = store.dangerThresh;
  
  closeModal();
  showToast('Alert Thresholds Saved Successfully');
  if (activeFSSensor) updateFSView();
}

function triggerBannerAlert(level, val) {
  const banner = document.getElementById('alert-banner');
  const text = document.getElementById('alert-text');
  if (!banner || !text) return;
  
  banner.classList.add('active');
  text.innerText = `Alert: Elevated gas concentration detected (${val} ppm)`;
  
  const badge = document.getElementById('notif-badge');
  if (badge) badge.style.display = 'block';
}

function closeBanner() {
  const banner = document.getElementById('alert-banner');
  if (banner) banner.classList.remove('active');
}

function toggleAlerts() {
  store.alertsEnabled = !store.alertsEnabled;
  showToast(store.alertsEnabled ? 'Notifications Enabled' : 'Notifications Muted');
  
  const badge = document.getElementById('notif-badge');
  if (badge) badge.style.display = 'none';
}

function exportData() {
  if (store.records.length === 0) {
    showToast("No data available to export");
    return;
  }
  
  let csv = "Timestamp,Sensor,Value(ppm)\n";
  store.records.forEach(r => {
    csv += `${new Date(r.ts).toISOString()},${r.sensor},${r.value}\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', 'gas_monitor_records.csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  showToast("Sensor data exported to CSV");
}

function clearRecords() {
  store.records = [];
  const body = document.getElementById('records-body');
  if (body) {
    body.innerHTML = `<div class="records-empty"><i class="fas fa-satellite-dish"></i><p>Waiting for sensor data…</p></div>`;
  }
  showToast("Sensor logs cleared");
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.innerText = message;
  
  toast.style.cssText = `
    background: rgba(15, 23, 42, 0.9);
    color: #fff;
    padding: 12px 24px;
    border-radius: 8px;
    margin-top: 10px;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    font-family: 'Space Mono', monospace;
    font-size: 14px;
    opacity: 0;
    transform: translateY(20px);
    transition: all 0.3s ease;
  `;
  
  container.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
  `;
  
  container.appendChild(toast);
  
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── 7. Full Screen Detailed View Logic ──────────────────────────────
function expandCard(sensor) {
  activeFSSensor = sensor;
  const overlay = document.getElementById('fs-overlay');
  
  const title = document.getElementById('fs-title');
  const badge = document.getElementById('fs-badge');
  const icon = document.getElementById('fs-icon');
  
  if (sensor === 'mq2') {
    title.innerText = 'MQ2 Combustibles';
    badge.innerText = 'LPG / SMOKE';
    icon.className = 'fas fa-fire';
    icon.style.color = 'var(--c-cyan)';
  } else {
    title.innerText = 'MQ135 Air Quality';
    badge.innerText = 'GAS / CO2 / NH3';
    icon.className = 'fas fa-wind';
    icon.style.color = 'var(--c-violet)';
  }

  if(overlay) overlay.classList.add('open');
  updateFSView();
}

function closeFS() {
  activeFSSensor = null;
  const overlay = document.getElementById('fs-overlay');
  if(overlay) overlay.classList.remove('open');
}

function updateFSView() {
  if (!activeFSSensor) return;
  
  const currentVal = store[activeFSSensor];
  const history = store[`${activeFSSensor}History`];
  const color = activeFSSensor === 'mq2' ? '#63c8ff' : '#a78bfa';
  
  const valEl = document.getElementById('fs-val');
  if(valEl) valEl.innerText = currentVal;
  
  if (history.length > 0) {
    const minEl = document.getElementById('fs-min');
    const maxEl = document.getElementById('fs-max');
    const avgEl = document.getElementById('fs-avg');
    
    if(minEl) minEl.innerText = Math.min(...history);
    if(maxEl) maxEl.innerText = Math.max(...history);
    if(avgEl) avgEl.innerText = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
  }
  
  let status = 'safe';
  let text = 'SAFE';
  if (currentVal >= store.dangerThresh) { status = 'danger'; text = 'DANGER'; }
  else if (currentVal >= store.warnThresh) { status = 'warn'; text = 'WARNING'; }
  
  const statusEl = document.getElementById('fs-status');
  if(statusEl) {
    statusEl.className = `status-badge ${status}`;
    statusEl.innerText = text;
  }
  
  const canvas = document.getElementById('fs-canvas');
  if (!canvas) return;
  
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width - 40; 
  canvas.height = rect.height - 40;
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (history.length === 0) return;
  
  const maxVal = 1400; 
  const maxPoints = 60;
  const step = canvas.width / (maxPoints - 1);
  const offset = maxPoints - history.length;
  
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, `${color}44`); 
  gradient.addColorStop(1, `${color}00`); 
  
  ctx.beginPath();
  history.forEach((val, i) => {
    const x = (i + offset) * step;
    const y = canvas.height - (val / maxVal) * canvas.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(canvas.width, canvas.height);
  ctx.lineTo(offset * step, canvas.height);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  
  history.forEach((val, i) => {
    const x = (i + offset) * step;
    const y = canvas.height - (val / maxVal) * canvas.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 2, y - 2, 4, 4);
  });
  ctx.stroke();
  
  function drawThresh(val, c) {
    const y = canvas.height - (val / maxVal) * canvas.height;
    ctx.beginPath();
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
    ctx.setLineDash([]); 
  }
  
  drawThresh(store.warnThresh, 'rgba(251, 191, 36, 0.5)'); 
  drawThresh(store.dangerThresh, 'rgba(248, 113, 113, 0.5)'); 
}

window.addEventListener('resize', () => {
  drawHistoryChart();
  if (activeFSSensor) updateFSView();
});

document.addEventListener('DOMContentLoaded', () => {
  setInterval(updateUptime, 1000);
  setInterval(updateHealthBars, 5000); 
  
  const modal = document.getElementById('threshold-modal');
  if(modal) modal.style.display = 'none';
});