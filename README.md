# SENTINEL-01 — Emergency Reconnaissance & Response Dashboard

A frontend dashboard for the "AI-Powered Emergency Reconnaissance & Response Robot" project.
Plain HTML / CSS / JS — no build step, no framework. Open `index.html` in a browser (or serve
the folder) and it runs.

## Files
- `index.html` — page structure, all 13 dashboard modules
- `style.css`  — all visual styling, driven by CSS variables at the top (`:root`)
- `script.js`  — all behaviour, driven by the `CONFIG` object at the top

## What's already working
| # | Module | How it works right now |
|---|--------|-------------------------|
| 1 | Live location | Browser geolocation + a free OpenStreetMap/Leaflet map |
| 2 | Live camera feed | Your device camera via `getUserMedia` (click "Enable Camera") |
| 3 | Detect objects | Simulated — random object events every few seconds |
| 4 | Human/person detection | Simulated |
| 5 | Vehicle detection | Simulated |
| 6 | Hazard detection | Simulated, and auto-triggers the SOS alert bar |
| 7 | Battery | Real device battery if the browser supports the Battery API, else simulated drain |
| 8 | Onboard temperature | Simulated sensor value |
| 9 | Weather | Real live weather via the free Open-Meteo API (no key needed) |
| 10 | Date / time | Real system clock |
| 11 | Connectivity | Real browser online/offline status |
| 12 | Nearest emergency/police | Real query to OpenStreetMap's Overpass API for nearby police/hospital/fire stations, with a static fallback list if the request fails |
| 13 | SOS / alert status | Manual button + auto-triggered by hazard detection |

Everything simulated is clearly commented in `script.js` so you can swap it for real data.

## How to customize
- **Colours / fonts / spacing**: edit the `:root` variables at the top of `style.css`.
- **Robot name, mission title, copy**: edit the text directly in `index.html`.
- **Timings, thresholds, default location**: edit the `CONFIG` object at the top of `script.js`.
- **Add/remove a dashboard module**: copy an existing `.panel` block in `index.html`, give it a
  new `id`, then add matching logic in `script.js`. The module numbering badges (`01`–`13`)
  are just `<span class="mod-badge">`.

## Wiring in your real robot / AI model
The three places to connect real data are all in `script.js`:

1. **Detection feed** — replace the body of `runDetectionCycle()`. If your robot streams
   detections over a WebSocket or MQTT bridge, listen for messages there and call
   `setDetectionState(id, active, valueText)` and `logDetection(text)` with real values instead
   of random ones.
2. **Telemetry** — replace `refreshBatteryFromDevice()` and the onboard-temperature line inside
   `tickTelemetry()` with a `fetch()`/WebSocket call to your robot's telemetry endpoint.
3. **GPS** — the map already listens to `navigator.geolocation`. If the *robot's* GPS (not the
   browser device's) is the real source of truth, replace the geolocation calls with your
   robot's GPS feed and call `updateLocation(lat, lon)` yourself.

## Notes for your project report
The strip in the header (Robot → Camera → AI Detection → Dashboard → Alert / GPS) is a live,
animated version of the system flow diagram — each node lights up as that stage actually fires,
so it doubles as a working diagram and a system-status indicator.
