/* ============================================================
   CONFIG — tweak these to change behaviour without touching
   the logic below.
   ============================================================ */
const CONFIG = {
  // Used only if the browser denies/has no geolocation.
  fallbackLocation: { lat: 18.5204, lon: 73.8567, label: "Pune, MH (fallback)" },

  // How often the simulated AI "detects" something (ms).
  detectionIntervalMs: 4000,

  // How often telemetry (battery/temp/uptime) refreshes (ms).
  telemetryIntervalMs: 3000,

  // How often weather is re-fetched (ms). Uses Open-Meteo, no API key required.
  weatherIntervalMs: 10 * 60 * 1000,

  // Radius (metres) to search for nearby police/emergency stations via Overpass API.
  nearestSearchRadiusM: 5000,

  // Simulated starting battery percentage and drain rate per tick.
  batteryStart: 92,
  batteryDrainPerTick: 0.3,
};

/* ============================================================
   SMALL HELPERS
   ============================================================ */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function logDetection(text) {
  const log = $("detectLog");
  const li = document.createElement("li");
  const t = new Date().toLocaleTimeString();
  li.innerHTML = `<span>${t}</span> — ${text}`;
  log.prepend(li);
  while (log.children.length > 12) log.removeChild(log.lastChild);
}

/* ============================================================
   1. CLOCK  (Module 10 — Date / time)
   ============================================================ */
function tickClock() {
  const now = new Date();
  $("clockTime").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  $("clockDate").textContent = now.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}
setInterval(tickClock, 1000);
tickClock();

/* ============================================================
   2. CONNECTIVITY  (Module 11)
   ============================================================ */
function updateConnectivity() {
  const chip = $("connectivityChip");
  const online = navigator.onLine;
  chip.classList.toggle("online", online);
  chip.classList.toggle("offline", !online);
  $("connectivityText").textContent = online ? "ONLINE" : "OFFLINE";
  $("footerConn").textContent = online ? "Online" : "Offline";
}
window.addEventListener("online", updateConnectivity);
window.addEventListener("offline", updateConnectivity);
updateConnectivity();

/* ============================================================
   3. LIVE CAMERA FEED  (Module 02)
   ============================================================ */
const camToggle = $("camToggle");
const camVideo = $("camVideo");
const camPlaceholder = $("camPlaceholder");
let camStream = null;

camToggle.addEventListener("click", async () => {
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
    camVideo.srcObject = null;
    camPlaceholder.style.display = "flex";
    camToggle.textContent = "ENABLE CAMERA";
    camToggle.classList.remove("active");
    setPipelineState("camera", false);
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    camVideo.srcObject = camStream;
    camPlaceholder.style.display = "none";
    camToggle.textContent = "DISABLE CAMERA";
    camToggle.classList.add("active");
    setPipelineState("camera", true);
  } catch (err) {
    camPlaceholder.querySelector("p").textContent =
      "Camera unavailable (permission denied or no device found).";
  }
});

/* ============================================================
   4. LIVE LOCATION MAP  (Module 01)
   ============================================================ */
let map, marker;
let currentLat = CONFIG.fallbackLocation.lat;
let currentLon = CONFIG.fallbackLocation.lon;

function initMap(lat, lon) {
  map = L.map("mapView", { zoomControl: true, attributionControl: true }).setView([lat, lon], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  marker = L.marker([lat, lon]).addTo(map).bindPopup("Robot location");
  $("coordsText").textContent = `lat ${lat.toFixed(4)}, lon ${lon.toFixed(4)}`;
}

function updateLocation(lat, lon) {
  currentLat = lat;
  currentLon = lon;
  if (!map) {
    initMap(lat, lon);
  } else {
    marker.setLatLng([lat, lon]);
    map.panTo([lat, lon]);
  }
  $("coordsText").textContent = `lat ${lat.toFixed(4)}, lon ${lon.toFixed(4)}`;
}

if ("geolocation" in navigator) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      updateLocation(pos.coords.latitude, pos.coords.longitude);
      fetchWeather(pos.coords.latitude, pos.coords.longitude);
      fetchNearestServices(pos.coords.latitude, pos.coords.longitude);
      navigator.geolocation.watchPosition(
        (p) => updateLocation(p.coords.latitude, p.coords.longitude),
        () => {},
        { enableHighAccuracy: true }
      );
    },
    () => {
      // permission denied / unavailable -> fall back
      initMap(currentLat, currentLon);
      fetchWeather(currentLat, currentLon);
      fetchNearestServices(currentLat, currentLon);
    }
  );
} else {
  initMap(currentLat, currentLon);
  fetchWeather(currentLat, currentLon);
  fetchNearestServices(currentLat, currentLon);
}

/* ============================================================
   5. PIPELINE STRIP (signature element — mirrors the notebook diagram)
   ============================================================ */
function setPipelineState(node, on, alert = false) {
  const el = document.querySelector(`.pipe-node[data-node="${node}"]`);
  if (!el) return;
  el.classList.toggle("active", on);
  el.classList.toggle("alert", alert && on);
  if (on) setTimeout(() => el.classList.remove("active", "alert"), 1200);
}

/* ============================================================
   6. SIMULATED DETECTION  (Modules 03–06)
   ------------------------------------------------------------
   Replace `runDetectionCycle()` with a call to your real model /
   robot API (e.g. a WebSocket message handler) to go from demo
   data to live data. Everything downstream (UI, pipeline, SOS
   auto-trigger) already reacts to the same three functions:
   setDetectionState() and logDetection().
   ============================================================ */
const OBJECT_LABELS = ["debris", "smoke plume", "collapsed beam", "loose cable", "fire source", "chemical drum"];

function setDetectionState(id, active, valueText) {
  const el = $(id);
  el.classList.toggle("flagged", active);
  el.querySelector(".detect-value").textContent = valueText;
}

let objectCount = 0;

function runDetectionCycle() {
  setPipelineState("robot", true);
  setPipelineState("camera", true);
  setTimeout(() => setPipelineState("ai", true), 150);
  setTimeout(() => setPipelineState("dash", true), 350);

  // Objects — always ticks up a little
  const newObjects = Math.random() > 0.5 ? Math.floor(Math.random() * 2) + 1 : 0;
  if (newObjects > 0) {
    objectCount += newObjects;
    setDetectionState("det-object", false, String(objectCount));
    const label = OBJECT_LABELS[Math.floor(Math.random() * OBJECT_LABELS.length)];
    logDetection(`Object detected: ${label} (${(Math.random() * 30 + 65).toFixed(0)}% confidence)`);
  }

  // Human presence — occasional
  const humanFound = Math.random() < 0.28;
  setDetectionState("det-human", humanFound, humanFound ? "DETECTED" : "CLEAR");
  if (humanFound) logDetection("Human presence detected in frame");

  // Vehicle presence — occasional
  const vehicleFound = Math.random() < 0.18;
  setDetectionState("det-vehicle", vehicleFound, vehicleFound ? "DETECTED" : "CLEAR");
  if (vehicleFound) logDetection("Vehicle detected nearby");

  // Hazard — rarer, and escalates to the SOS panel
  const hazardFound = Math.random() < 0.12;
  setDetectionState("det-hazard", hazardFound, hazardFound ? "HAZARD" : "CLEAR");
  if (hazardFound) {
    logDetection("⚠ Hazard flagged — see Alert Status");
    setPipelineState("gps", true, true);
    setPipelineState("alert", true, true);
    triggerAlert(`Hazard auto-flagged by onboard AI at ${new Date().toLocaleTimeString()}`);
  }
}
setInterval(runDetectionCycle, CONFIG.detectionIntervalMs);
runDetectionCycle();

/* ============================================================
   7. TELEMETRY — battery, onboard temperature, uptime  (Modules 07 & 10)
   ============================================================ */
let battery = CONFIG.batteryStart;
const startTime = Date.now();

function renderBattery(pct) {
  $("batteryFill").style.width = `${pct}%`;
  $("batteryValue").textContent = `${pct.toFixed(0)}%`;
  const fill = $("batteryFill");
  fill.style.background =
    pct < 20
      ? "linear-gradient(90deg,#ff3b30,#ff5f3d)"
      : "linear-gradient(90deg, var(--accent-green), var(--accent-blue))";
}

async function refreshBatteryFromDevice() {
  // Real hardware: navigator.getBattery() reports the *browser device's*
  // battery, not the robot's. Swap this for a call to your robot API.
  if (navigator.getBattery) {
    try {
      const b = await navigator.getBattery();
      battery = b.level * 100;
      return;
    } catch (e) {
      /* fall through to simulation */
    }
  }
  battery = Math.max(0, battery - CONFIG.batteryDrainPerTick);
}

function tickTelemetry() {
  refreshBatteryFromDevice().then(() => renderBattery(battery));

  // Onboard sensor temperature — simulated. Swap for real sensor feed.
  const onboardTemp = (34 + Math.sin(Date.now() / 15000) * 4 + Math.random()).toFixed(1);
  $("tempValue").textContent = `${onboardTemp} °C`;

  // Uptime
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const h = pad(Math.floor(elapsed / 3600));
  const m = pad(Math.floor((elapsed % 3600) / 60));
  const s = pad(elapsed % 60);
  $("uptimeValue").textContent = `${h}:${m}:${s}`;
}
setInterval(tickTelemetry, CONFIG.telemetryIntervalMs);
tickTelemetry();

/* ============================================================
   8. WEATHER  (Module 09) — Open-Meteo, free, no API key
   ============================================================ */
const WEATHER_CODES = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Fog", 51: "Light drizzle", 61: "Light rain", 63: "Rain",
  65: "Heavy rain", 71: "Snow", 80: "Rain showers", 95: "Thunderstorm",
};

async function fetchWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url);
    const data = await res.json();
    const cw = data.current_weather;
    if (cw) {
      const desc = WEATHER_CODES[cw.weathercode] || "—";
      $("weatherValue").textContent = desc;
      $("ambientValue").textContent = `${cw.temperature.toFixed(1)} °C`;
    }
  } catch (e) {
    $("weatherValue").textContent = "Unavailable";
  }
  setTimeout(() => fetchWeather(currentLat, currentLon), CONFIG.weatherIntervalMs);
}

/* ============================================================
   9. NEAREST EMERGENCY / POLICE SERVICES  (Module 12)
   Uses the Overpass API (free, OpenStreetMap data, no key).
   Falls back to a static placeholder list if the request fails
   or times out — replace FALLBACK_SERVICES with real local data.
   ============================================================ */
const FALLBACK_SERVICES = [
  { name: "City Police Station", distanceKm: 2.1 },
  { name: "General Hospital", distanceKm: 3.4 },
  { name: "Fire Station 4", distanceKm: 4.0 },
];

async function fetchNearestServices(lat, lon) {
  const list = $("nearestList");
  const query = `
    [out:json][timeout:8];
    (
      node["amenity"="police"](around:${CONFIG.nearestSearchRadiusM},${lat},${lon});
      node["amenity"="hospital"](around:${CONFIG.nearestSearchRadiusM},${lat},${lon});
      node["amenity"="fire_station"](around:${CONFIG.nearestSearchRadiusM},${lat},${lon});
    );
    out body 10;
  `;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    const results = (data.elements || [])
      .map((el) => ({
        name: el.tags?.name || el.tags?.amenity || "Unnamed station",
        distanceKm: haversineKm(lat, lon, el.lat, el.lon),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5);

    renderNearestList(results.length ? results : FALLBACK_SERVICES);
  } catch (e) {
    renderNearestList(FALLBACK_SERVICES);
  }
}

function renderNearestList(items) {
  const list = $("nearestList");
  list.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "nearest-item";
    li.innerHTML = `<span class="nearest-name">${item.name}</span><span class="nearest-dist">${item.distanceKm.toFixed(1)} km</span>`;
    list.appendChild(li);
  });
}

/* ============================================================
   10. SOS / ALERT STATUS  (Module 13)
   ============================================================ */
const sosPanel = $("sosPanel");
const sosButton = $("sosButton");
const sosStatusText = $("sosStatusText");
let alertActive = false;

function triggerAlert(reason) {
  alertActive = true;
  sosPanel.classList.add("active");
  sosStatusText.textContent = `ACTIVE ALERT — ${reason}`;
  sosButton.textContent = "CANCEL SOS";
}

function clearAlert() {
  alertActive = false;
  sosPanel.classList.remove("active");
  sosStatusText.textContent = "SYSTEM NOMINAL — NO ACTIVE ALERTS";
  sosButton.textContent = "TRIGGER SOS";
}

sosButton.addEventListener("click", () => {
  if (alertActive) {
    clearAlert();
  } else {
    triggerAlert(`Manual SOS triggered at ${new Date().toLocaleTimeString()}`);
    logDetection("🆘 Manual SOS triggered by operator");
    setPipelineState("alert", true, true);
  }
});
