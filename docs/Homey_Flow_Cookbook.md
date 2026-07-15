# Homey Flow cookbook (Recall alerts)

Recall accepts important home events from Homey Flows. Homey filters first; Recall ranks (severity, quiet hours, dedupe) and shows alerts on **Today**.

## Prerequisites

1. Connect Homey on Recall **Connectors** (Athom OAuth).
2. Click **Show webhook** and copy:
   - **URL** — `https://recall-app.net/api/webhooks/homey/<connectorId>`
   - **Secret** — send as `Authorization: Bearer <secret>` (or header `X-Recall-Homey-Secret`)
3. Sync Homey once so Ask can resolve device names.

## JSON body contract

```json
{
  "title": "Front door open too long",
  "message": "Contact sensor open for 5 minutes",
  "severity": "warn",
  "kind": "door_open_too_long",
  "deviceName": "Front door",
  "homeyDeviceId": "optional-homey-device-id",
  "occurredAt": "2026-07-15T20:14:03.000Z"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `title` | yes | Short line for Today |
| `message` | no | Extra detail |
| `severity` | no | `info` \| `warn` \| `emergency` (default `warn`) |
| `kind` | no | e.g. `door_opened`, `door_open_too_long`, `leak`, `smoke`, `security`, `other` |
| `deviceName` | no | Used for dedupe + display |
| `homeyDeviceId` | no | Optional Homey id |
| `occurredAt` | no | ISO datetime or epoch ms when the event happened; defaults to receive time |

Same `deviceName` + `kind` + `severity` within **10 minutes** is deduped. During quiet hours (**22:00–07:00** in `RECALL_TIMEZONE`), `info` alerts are filtered; `warn` and `emergency` still surface.

## Example Flow 1 — Door opened (exact time)

Use this so Ask can answer “when did the front door open?” from alerts (in addition to live `lastUpdated` from Homey sync).

**When**

- Contact alarm / door sensor becomes **open** (alarm goes true)

**Then**

- **HTTP request** → `POST` webhook URL  
- Header: `Authorization: Bearer <your-secret>`  
- Content-Type: `application/json`  
- Body:

```json
{
  "title": "Front door opened",
  "severity": "info",
  "kind": "door_opened",
  "deviceName": "Front door",
  "occurredAt": "2026-07-15T20:14:03.000Z"
}
```

Homey Logic cards can insert the current date/time into `occurredAt`. If omitted, Recall uses the webhook receive time.

Same device + kind + severity within **10 minutes** is deduped, so rapid re-opens within that window may collapse into one alert. Live Homey `lastUpdated` still answers “last changed” without a Flow.

## Example Flow 2 — Door open too long

**When**

- Contact alarm / door sensor becomes **open**
- **And** stays open for **5 minutes** (timer / AND duration cards)

**Then**

```json
{
  "title": "Front door open too long",
  "severity": "warn",
  "kind": "door_open_too_long",
  "deviceName": "Front door"
}
```

## Example Flow 3 — Leak or smoke (emergency)

**When**

- Water leak alarm **true**, or smoke / fire alarm **true**

**Then**

```json
{
  "title": "Water leak detected",
  "severity": "emergency",
  "kind": "leak",
  "deviceName": "Laundry sensor"
}
```

Use `kind`: `smoke` and title accordingly for smoke detectors.

## Example Flow 4 — Security / away

**When**

- Alarm system armed / motion while Away (your preference)

**Then**

```json
{
  "title": "Motion while Away",
  "severity": "warn",
  "kind": "security",
  "deviceName": "Hallway motion"
}
```

## Test without Homey

On Connectors → Homey → **Send test alert**. You should see “Recall Homey test alert” on Today (info severity; may be quiet-hour filtered overnight).

## Ask control (after Sync)

Examples: “Is the garage door open?”, “Turn off the porch lights”, “Trigger Away mode Flow”. Risky actions (locks, garage, security Flows) ask you to **confirm**.
