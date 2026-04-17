import { useEffect } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import { latLngBounds, type LatLngExpression } from 'leaflet'
import type { ContactPin } from '../types'

type ContactMapProps = {
  pins: ContactPin[]
}

function MapViewport({ pins }: ContactMapProps) {
  const map = useMap()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize()

      if (pins.length === 0) {
        map.setView([20, 0], 2)
        return
      }

      const bounds = latLngBounds(pins.map((pin) => [pin.lat, pin.lon] as LatLngExpression))
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 7 })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [map, pins])

  return null
}

export function ContactMap({ pins }: ContactMapProps) {
  const firstPin = pins.at(0)
  const center: LatLngExpression = firstPin ? [firstPin.lat, firstPin.lon] : [20, 0]

  return (
    <div className="map-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Contact Map</p>
          <h2>Worked stations at a glance</h2>
        </div>
        <p className="muted">{pins.length > 0 ? `${pins.length} plotted contacts.` : 'No plotted contact coordinates yet.'}</p>
      </div>

      <MapContainer center={center} zoom={pins.length > 0 ? 3 : 2} scrollWheelZoom className="world-map">
        <MapViewport pins={pins} />
        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        {pins.map((pin) => (
          <CircleMarker
            key={pin.id}
            center={[pin.lat, pin.lon] as LatLngExpression}
            pathOptions={{ color: '#7db5ff', fillColor: '#7db5ff', fillOpacity: 0.85, weight: 1.5 }}
            radius={8}
          >
            <Popup>
              <strong>{pin.callsign}</strong>
              <div>{pin.label}</div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
