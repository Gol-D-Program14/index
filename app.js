/*
  CROPWATCH FRONTEND

  Expected sensor payload from your ESP32:

  {
    "device": "CROPWATCH-ESP32",
    "timestamp": "2026-10-04T05:30:00.000Z",
    "ph": 6.10,
    "airTemperature": 27.4,
    "humidity": 72.5,
    "waterTemperature": 24.8,
    "npk": 840,
    "dissolvedOxygen": 6.7
  }

  The dashboard stores every received reading in IndexedDB.
  If the network disappears, records remain on the user's device.
  When the network returns, the app attempts to send pending records
  to your server API.

  Change API_URL below when your backend is ready.
*/

const CONFIG = {
  API_URL: "https://YOUR-SERVER.example/api/readings",
  CAMERA_URL: "",
  SYNC_INTERVAL_MS: 15000,
  MAX_HISTORY_ROWS: 50
};

const DB_NAME = "cropwatchDB";
const DB_VERSION = 1;
const STORE_NAME = "readings";

let db;
let lastAlertState = {};

document.addEventListener("DOMContentLoaded", async () => {
  await initDatabase();
  setupEvents();
  updateConnectionUI();
  loadCamera();
  await refreshDashboard();

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  setInterval(async () => {
    updateConnectionUI();
    if (navigator.onLine) {
      await syncPendingRecords();
    }
    await refreshDashboard();
  }, CONFIG.SYNC_INTERVAL_MS);
});

function setupEvents() {
  document.getElementById("notificationBtn").addEventListener("click", requestNotifications);
  document.getElementById("demoBtn").addEventListener("click", generateDemoReading);
  document.getElementById("exportBtn").addEventListener("click", exportData);
  document.getElementById("clearBtn").addEventListener("click", clearData);
  document.getElementById("cameraSaveBtn").addEventListener("click", saveCameraUrl);
}

function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true
        });

        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("synced", "synced", { unique: false });
      }
    };

    request.onsuccess = event => {
      db = event.target.result;
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

function saveReading(reading) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const data = {
      device: reading.device || "CROPWATCH-ESP32",
      timestamp: reading.timestamp || new Date().toISOString(),
      ph: Number(reading.ph),
      airTemperature: Number(reading.airTemperature),
      humidity: Number(reading.humidity),
      waterTemperature: Number(reading.waterTemperature),
      npk: Number(reading.npk),
      dissolvedOxygen: Number(reading.dissolvedOxygen),
      synced: false
    };

    const request = store.add(data);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllReadings() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
      );
      resolve(results);
    };

    request.onerror = () => reject(request.error);
  });
}

function getPendingReadings() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const index = transaction.objectStore(STORE_NAME).index("synced");
    const request = index.getAll(false);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function markAsSynced(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const record = request.result;
      if (!record) {
        resolve();
        return;
      }

      record.synced = true;
      store.put(record);
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function processReading(reading) {
  await saveReading(reading);
  renderReading(reading);
  checkAlerts(reading);
  await refreshDashboard();

  if (navigator.onLine) {
    await syncPendingRecords();
  }
}

async function syncPendingRecords() {
  if (!navigator.onLine) return;

  const pending = await getPendingReadings();
  if (!pending.length) return;

  for (const record of pending) {
    try {
      const response = await fetch(CONFIG.API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(record)
      });

      if (response.ok) {
        await markAsSynced(record.id);
      }
    } catch (error) {
      console.log("Sync waiting:", error);
      break;
    }
  }

  await refreshDashboard();
}

async function refreshDashboard() {
  const readings = await getAllReadings();
  const latest = readings[0];

  document.getElementById("storedRecords").textContent = readings.length;
  document.getElementById("recordCount").textContent = `${readings.length} records`;

  const pending = readings.filter(item => !item.synced).length;
  document.getElementById("pendingRecords").textContent = pending;

  if (latest) {
    renderReading(latest);
    renderHistory(readings);
  }
}

function renderReading(data) {
  setValue("phValue", data.ph);
  setValue("airTempValue", data.airTemperature);
  setValue("humidityValue", data.humidity);
  setValue("waterTempValue", data.waterTemperature);
  setValue("npkValue", data.npk);
  setValue("doValue", data.dissolvedOxygen);

  setSensorStatus("phStatus", getPhStatus(data.ph));
  setSensorStatus("airTempStatus", getAirTemperatureStatus(data.airTemperature));
  setSensorStatus("humidityStatus", getHumidityStatus(data.humidity));
  setSensorStatus("waterTempStatus", getWaterTemperatureStatus(data.waterTemperature));
  setSensorStatus("npkStatus", getNpkStatus(data.npk));
  setSensorStatus("doStatus", getDoStatus(data.dissolvedOxygen));

  document.getElementById("lastUpdate").textContent = formatDate(data.timestamp);
  document.getElementById("deviceName").textContent = data.device || "CROPWATCH-ESP32";
}

function setValue(id, value) {
  document.getElementById(id).textContent =
    Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "--";
}

function setSensorStatus(id, result) {
  const element = document.getElementById(id);
  element.textContent = result.text;
  element.className = `status ${result.level}`;
}

function getPhStatus(value) {
  if (value >= 5.5 && value <= 6.5) return { text: "Within target range", level: "normal" };
  if (value >= 5.0 && value <= 7.0) return { text: "Check pH level", level: "warning" };
  return { text: "pH requires attention", level: "danger" };
}

function getAirTemperatureStatus(value) {
  if (value >= 18 && value <= 30) return { text: "Within configured range", level: "normal" };
  if (value >= 15 && value <= 34) return { text: "Temperature outside target", level: "warning" };
  return { text: "Temperature requires attention", level: "danger" };
}

function getHumidityStatus(value) {
  if (value >= 50 && value <= 80) return { text: "Within configured range", level: "normal" };
  if (value >= 40 && value <= 90) return { text: "Humidity outside target", level: "warning" };
  return { text: "Humidity requires attention", level: "danger" };
}

function getWaterTemperatureStatus(value) {
  if (value >= 18 && value <= 26) return { text: "Within configured range", level: "normal" };
  if (value >= 15 && value <= 30) return { text: "Water temperature outside target", level: "warning" };
  return { text: "Water temperature requires attention", level: "danger" };
}

function getNpkStatus(value) {
  if (value >= 600 && value <= 1200) return { text: "Configured nutrient range", level: "normal" };
  if (value >= 400 && value <= 1500) return { text: "Check nutrient concentration", level: "warning" };
  return { text: "Nutrient level requires attention", level: "danger" };
}

function getDoStatus(value) {
  if (value >= 5) return { text: "Good dissolved oxygen", level: "normal" };
  if (value >= 3) return { text: "Low dissolved oxygen", level: "warning" };
  return { text: "Critical dissolved oxygen", level: "danger" };
}

function renderHistory(readings) {
  const body = document.getElementById("historyBody");
  const rows = readings.slice(0, CONFIG.MAX_HISTORY_ROWS);

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No sensor records yet.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(record => `
    <tr>
      <td>${escapeHtml(formatDate(record.timestamp))}</td>
      <td>${safeNumber(record.ph)}</td>
      <td>${safeNumber(record.airTemperature)}</td>
      <td>${safeNumber(record.humidity)}%</td>
      <td>${safeNumber(record.waterTemperature)}</td>
      <td>${safeNumber(record.npk)}</td>
      <td>${safeNumber(record.dissolvedOxygen)}</td>
      <td>${record.synced ? "Synced" : "Stored locally"}</td>
    </tr>
  `).join("");
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "--";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "medium"
  });
}

function updateConnectionUI() {
  const online = navigator.onLine;
  const dot = document.getElementById("connectionDot");
  const text = document.getElementById("connectionText");
  const banner = document.getElementById("offlineBanner");

  dot.className = `status-dot ${online ? "online" : ""}`;
  text.textContent = online ? "Online" : "Offline";
  banner.classList.toggle("hidden", online);
}

function handleOnline() {
  updateConnectionUI();
  showToast("Connection restored. Syncing stored records.");
  syncPendingRecords();
}

function handleOffline() {
  updateConnectionUI();
  showToast("Wi-Fi connection lost. Data will be stored locally.", true);
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    showToast("This browser does not support notifications.", true);
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission === "granted") {
    showToast("Notifications enabled.");
    document.getElementById("notificationBtn").textContent = "Notifications enabled";
  } else {
    showToast("Notification permission was not granted.", true);
  }
}

function notify(title, message) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, {
      body: message,
      tag: "cropwatch-alert"
    });
  }

  showToast(`${title}: ${message}`, true);
}

function checkAlerts(data) {
  const checks = {
    ph: getPhStatus(data.ph),
    airTemperature: getAirTemperatureStatus(data.airTemperature),
    humidity: getHumidityStatus(data.humidity),
    waterTemperature: getWaterTemperatureStatus(data.waterTemperature),
    npk: getNpkStatus(data.npk),
    dissolvedOxygen: getDoStatus(data.dissolvedOxygen)
  };

  for (const [key, result] of Object.entries(checks)) {
    if (result.level === "danger" && lastAlertState[key] !== result.text) {
      notify("CROPWATCH alert", result.text);
    }

    lastAlertState[key] = result.text;
  }
}

function showToast(message, alert = false) {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");

  toast.className = `toast ${alert ? "alert" : ""}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 5000);
}

function generateDemoReading() {
  const reading = {
    device: "CROPWATCH-ESP32-DEMO",
    timestamp: new Date().toISOString(),
    ph: Number((5.7 + Math.random() * 0.8).toFixed(2)),
    airTemperature: Number((24 + Math.random() * 7).toFixed(2)),
    humidity: Number((60 + Math.random() * 20).toFixed(2)),
    waterTemperature: Number((22 + Math.random() * 5).toFixed(2)),
    npk: Math.round(650 + Math.random() * 500),
    dissolvedOxygen: Number((5 + Math.random() * 2.5).toFixed(2))
  };

  processReading(reading);
}

function saveCameraUrl() {
  const url = document.getElementById("cameraUrlInput").value.trim();

  if (!url) {
    showToast("Enter a camera stream URL.", true);
    return;
  }

  localStorage.setItem("cropwatchCameraUrl", url);
  setCamera(url);
}

function loadCamera() {
  const saved = localStorage.getItem("cropwatchCameraUrl") || CONFIG.CAMERA_URL;

  if (saved) {
    document.getElementById("cameraUrlInput").value = saved;
    setCamera(saved);
  }
}

function setCamera(url) {
  const image = document.getElementById("cameraFeed");
  const placeholder = document.getElementById("cameraPlaceholder");
  const status = document.getElementById("cameraStatus");

  image.src = url;

  image.onload = () => {
    image.classList.add("active");
    placeholder.style.display = "none";
    status.textContent = "Camera connected";
  };

  image.onerror = () => {
    image.classList.remove("active");
    placeholder.style.display = "grid";
    status.textContent = "Camera unavailable";
  };
}

async function exportData() {
  const readings = await getAllReadings();

  if (!readings.length) {
    showToast("There is no stored data to export.", true);
    return;
  }

  const headers = [
    "timestamp",
    "device",
    "ph",
    "airTemperature",
    "humidity",
    "waterTemperature",
    "npk",
    "dissolvedOxygen",
    "synced"
  ];

  const csv = [
    headers.join(","),
    ...readings.map(row =>
      headers.map(key => csvValue(row[key])).join(",")
    )
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `cropwatch-readings-${Date.now()}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

function csvValue(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

async function clearData() {
  const confirmed = confirm(
    "Delete all locally stored CROPWATCH readings? This cannot be undone."
  );

  if (!confirmed) return;

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).clear();

    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });

  await refreshDashboard();
  showToast("Stored data cleared.");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/*
  PUBLIC FUNCTION FOR ESP32 OR YOUR WEB APP

  When you connect this dashboard to a backend, call:

  receiveSensorData({
    ph: 6.1,
    airTemperature: 27.4,
    humidity: 72,
    waterTemperature: 24.5,
    npk: 850,
    dissolvedOxygen: 6.4
  });

  This saves the reading locally first.
*/
window.receiveSensorData = async function(data) {
  await processReading({
    ...data,
    timestamp: data.timestamp || new Date().toISOString(),
    device: data.device || "CROPWATCH-ESP32"
  });
};
