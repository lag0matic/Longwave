# Integrating External Software With Longwave

This document is for other software that wants to submit log data directly into a running Longwave server.

The most likely use case is a companion desktop application such as ShackStack, but the same contract works for any trusted local or remote client.

## Auth Model

Use the Longwave **client API token**.

Send it on every request as:

```http
X-Api-Key: <client token>
```

Do **not** use the admin token for normal logging integration.

## Base URL

All examples below assume a base URL like:

```text
https://radio.example.net/api/v1
```

or on LAN:

```text
https://192.168.1.50/api/v1
```

## Recommended Integration Strategy

The easiest live integration is:

1. list logbooks
2. create the desired logbook if it does not exist yet
3. submit each completed QSO with `POST /contacts`

This is a better first integration than bulk ADIF handoff because it:

- supports real-time logging
- gives immediate request/response feedback
- avoids re-uploading a full session file

ADIF import is still available later for backfill or bulk transfer.

## Endpoints

### Check operator context

```http
GET /me
```

Use this if the integrating app wants to confirm the server identity and operator callsign.

Example response:

```json
{
  "id": "user-id",
  "username": "operator",
  "callsign": "W8STR"
}
```

### List logbooks

```http
GET /logbooks
```

Example response:

```json
[
  {
    "id": "logbook-id",
    "name": "POTA Hunting April",
    "operatorCallsign": "W8STR",
    "parkReference": null,
    "activationDate": null,
    "notes": "LONGWAVE_KIND=pota;POTA_MODE=hunting",
    "contactCount": 143,
    "syncState": "synced"
  }
]
```

### Create a logbook

```http
POST /logbooks
Content-Type: application/json
```

Request body:

```json
{
  "name": "POTA Hunting April",
  "operator_callsign": "W8STR",
  "park_reference": null,
  "activation_date": null,
  "notes": "LONGWAVE_KIND=pota;POTA_MODE=hunting"
}
```

Notes:

- `name` and `operator_callsign` are required
- `park_reference` and `activation_date` are mainly for POTA activation logs
- `notes` is how Longwave currently stores logbook kind metadata

Useful `notes` values:

- Standard log:

```text
LONGWAVE_KIND=standard;POTA_MODE=hunting
```

- POTA hunting log:

```text
LONGWAVE_KIND=pota;POTA_MODE=hunting
```

- POTA activating log:

```text
LONGWAVE_KIND=pota;POTA_MODE=activating
```

### Submit one contact

```http
POST /contacts
Content-Type: application/json
```

Request body:

```json
{
  "logbook_id": "logbook-id",
  "station_callsign": "K5MIG",
  "operator_callsign": "W8STR",
  "qso_date": "20250427",
  "time_on": "225105",
  "band": "20m",
  "mode": "SSB",
  "frequency_khz": 14243.0,
  "park_reference": "US-3002",
  "rst_sent": "59",
  "rst_recvd": "59",
  "tx_power": "100",
  "name": "Samuel D Jamison",
  "qth": null,
  "county": null,
  "grid_square": "EM23pa",
  "country": "UNITED STATES OF AMERICA",
  "state": "TX",
  "dxcc": null,
  "lat": null,
  "lon": null
}
```

Minimum required fields for a valid Longwave contact create:

- `logbook_id`
- `station_callsign`
- `operator_callsign`
- `qso_date`
- `time_on`
- `band`
- `mode`
- `frequency_khz`

Recommended fields for radio logging integrations:

- `rst_sent`
- `rst_recvd`
- `tx_power`
- `park_reference` when logging a POTA hunter/activator contact

### Update one contact

```http
PATCH /contacts/{contact_id}
Content-Type: application/json
```

Use this if the integrating software supports editing an already-created QSO.

### Delete one contact

```http
DELETE /contacts/{contact_id}
```

Use this if the integrating software needs to remove a mistaken QSO after it has already been created on the server.

### Bulk ADIF import

```http
POST /logs/import?logbook_id=<id>&operator_callsign=<call>
Content-Type: multipart/form-data
```

Multipart form field name:

```text
file
```

This is the easiest bulk import path if the integrating software already knows how to export ADIF.

## Error Handling Expectations

- treat any `2xx` response as success
- surface the response body on non-`2xx`
- if a `404` comes back for `logbook not found`, refresh logbooks and recreate or remap as needed
- if the integrating software has its own offline queue, it should replay queued creates once the server is reachable again

## Suggested ShackStack Adapter Behavior

If another agent is implementing this for ShackStack, this is a good baseline:

1. Add a Longwave integration config block:
   - `baseUrl`
   - `clientApiToken`
   - `defaultOperatorCallsign`
   - `defaultLogbookName`
   - optional `defaultLogbookKind`
2. On first use:
   - `GET /logbooks`
   - find logbook by name
   - if missing, `POST /logbooks`
3. On completed QSO:
   - `POST /contacts`
4. If Longwave is unavailable:
   - queue locally
   - retry later
5. Never require the Longwave admin token for this workflow

## Minimal Example

```http
POST /api/v1/contacts
X-Api-Key: CLIENT_TOKEN
Content-Type: application/json
```

```json
{
  "logbook_id": "abc123",
  "station_callsign": "N4XYZ",
  "operator_callsign": "W8STR",
  "qso_date": "20260416",
  "time_on": "223500",
  "band": "20m",
  "mode": "USB",
  "frequency_khz": 14285.0,
  "rst_sent": "59",
  "rst_recvd": "59"
}
```

## Notes

- Longwave is currently a single-operator server model
- QRZ lookup/upload remains server-side and is unrelated to this logging integration path
- Rig control remains client-side and is unrelated to this logging integration path
