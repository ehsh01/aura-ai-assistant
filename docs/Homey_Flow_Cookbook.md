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
  "homeyDeviceId": "optional-homey-device-id"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `title` | yes | Short line for Today |
| `message` | no | Extra detail |
| `severity` | no | `info` \| `warn` \| `emergency` (default `warn`) |
| `kind` | no | e.g. `door_open_too_long`, `leak`, `smoke`, `security`, `other` |
| `deviceName` | no | Used for dedupe + display |
| `homeyDeviceId` | no | Optional Homey id |

Same `deviceName` + `kind` + `severity` within **10 minutes** is deduped. During quiet hours (**22:00–07:00** in `RECALL_TIMEZONE`), `info` alerts are filtered; `warn` and `emergency` still surface.

## Example Flow 1 — Door open too long

**When**

- Contact alarm / door sensor becomes **open**
- **And** stays open for **5 minutes** (timer / AND duration cards)

**Then**

- **HTTP request** → `POST` webhook URL  
- Header: `Authorization: Bearer <your-secret>`  
- Content-Type: `application/json`  
- Body:

```json
{
  "title": "Front door open too long",
  "severity": "warn",
  "kind": "door_open_too_long",
  "deviceName": "Front door"
}
```

## Example Flow 2 — Leak or smoke (emergency)

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

## Example Flow 3 — Security / away

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
