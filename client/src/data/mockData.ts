import type { ContactDraft, Spot } from '../types'

function utcStampParts() {
  const now = new Date()
  const qsoDate = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`
  const timeOn = `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`
  return { qsoDate, timeOn }
}

export const spots: Spot[] = [
  {
    id: 'spot-1',
    activatorCallsign: 'K8LW',
    parkReference: 'US-1234',
    frequencyKhz: 14286,
    mode: 'SSB',
    band: '20m',
    comments: 'Strong signal, calling CQ',
    spotterCallsign: 'N9LOG',
    spottedAt: '2026-04-14T18:05:00Z',
    lat: 39.86,
    lon: -86.27,
  },
  {
    id: 'spot-2',
    activatorCallsign: 'W1POTA',
    parkReference: 'US-4321',
    frequencyKhz: 14074,
    mode: 'FT8',
    band: '20m',
    comments: 'Digital run',
    spotterCallsign: 'K9DX',
    spottedAt: '2026-04-14T18:11:00Z',
    lat: 35.22,
    lon: -80.84,
  },
  {
    id: 'spot-3',
    activatorCallsign: 'VE3QRP',
    parkReference: 'CA-5001',
    frequencyKhz: 7035,
    mode: 'CW',
    band: '40m',
    comments: 'QRP portable',
    spotterCallsign: 'N2PARK',
    spottedAt: '2026-04-14T18:19:00Z',
    lat: 43.65,
    lon: -79.38,
  },
]

export const draftFromSpot = (
  spot: Spot,
  operatorCallsign = 'N0CALL',
  logbookId = 'lb-hunting',
): ContactDraft => {
  const { qsoDate, timeOn } = utcStampParts()
  return {
    stationCallsign: spot.activatorCallsign,
    operatorCallsign,
    logbookId,
    qsoDate,
    timeOn,
    band: spot.band,
    mode: spot.mode,
    frequencyKhz: spot.frequencyKhz,
    rstSent: '59',
    rstRcvd: '59',
    parkReference: spot.parkReference,
    lat: spot.lat,
    lon: spot.lon,
  }
}
