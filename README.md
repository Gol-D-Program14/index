# CROPWATCH Monitoring Dashboard

This project is a separated HTML, CSS, and JavaScript monitoring dashboard for the CROPWATCH hydroponic monitoring system.

## Included functions

1. pH monitoring
2. Air temperature monitoring
3. Humidity monitoring
4. Water temperature monitoring
5. NPK solution monitoring
6. Dissolved oxygen monitoring
7. Camera viewing
8. Online and offline status detection
9. Browser notifications
10. Local offline data storage using IndexedDB
11. Automatic synchronization of pending records
12. CSV export
13. Sensor history table
14. Demo sensor readings for testing

## Files

- index.html
- style.css
- app.js

## How the offline storage works

The dashboard saves every sensor reading to IndexedDB before attempting synchronization.

When Wi-Fi or Internet connectivity is unavailable:

- New readings remain on the user's device.
- The dashboard displays Offline mode.
- Pending records remain marked as Stored locally.
- The user can still view the latest readings and history.
- CSV export still works.

When the connection returns:

- The dashboard detects the online event.
- It sends pending records to the API defined in app.js.
- Successfully uploaded records become Synced.

## Connect your backend

Open app.js and change:

API_URL: "https://YOUR-SERVER.example/api/readings"

Your server should accept:

POST /api/readings

Example JSON:

{
  "device": "CROPWATCH-ESP32",
  "timestamp": "2026-10-04T05:30:00.000Z",
  "ph": 6.1,
  "airTemperature": 27.4,
  "humidity": 72.5,
  "waterTemperature": 24.8,
  "npk": 840,
  "dissolvedOxygen": 6.7
}

The API should return HTTP 200 to 299 after successful storage.

## Connect the ESP32

The recommended architecture is:

ESP32 sensors
    |
    v
ESP32 firmware
    |
    v
Backend API
    |
    v
CROPWATCH dashboard

The browser should not directly expose secret database credentials.

For an ESP32-only local network setup, the ESP32 can host a small HTTP API. For Internet monitoring, use a proper backend.

## Camera

The camera field accepts a browser-compatible image or MJPEG stream URL.

For an ESP32-CAM, the URL may look similar to:

http://ESP32-CAM-IP:81/stream

Replace the address with the actual camera address.

Some browsers and camera firmware configurations may require HTTPS or CORS configuration.

## Testing without an ESP32

Open the dashboard and click Generate test reading.

Each generated reading is stored in IndexedDB.

You can also test offline storage by:

1. Generate several readings.
2. Turn off Wi-Fi.
3. Generate another reading.
4. Reload the page.
5. Confirm that the record remains.
6. Turn Wi-Fi back on.
7. The dashboard will attempt to synchronize pending records.

## GitHub Pages

The dashboard can be placed in a GitHub repository.

GitHub Pages can host the frontend.

However, GitHub Pages cannot act as your database or API server.

Use a separate backend or database service for permanent remote storage.

## Important sensor detail

NPK monitoring depends on the sensor and measurement method used by your CROPWATCH hardware.

The frontend treats NPK as a numeric value in ppm. Change the unit and status ranges in app.js if your actual sensor outputs a different measurement.

The same principle applies to dissolved oxygen. Calibrate the sensor and configure the threshold values based on your experimental setup.

## Future backend endpoints

A practical backend can expose:

POST /api/readings
GET /api/readings
GET /api/readings/latest
GET /api/device/status

The frontend can later load historical data from GET /api/readings instead of relying only on browser storage.

## Security

Do not put database passwords, API private keys, or administrator credentials in app.js.

If the API requires authentication, use a safe public client token with server-side authorization rules.
