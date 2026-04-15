import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import type { ContactPin } from '../types'

type ContactMapProps = {
  pins: ContactPin[]
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
        <p className="muted">Interactive world map from contact coordinates.</p>
      </div>

      <MapContainer center={center} zoom={pins.length > 0 ? 3 : 2} scrollWheelZoom className="world-map">
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((pin) => (
          <CircleMarker
            key={pin.id}
            center={[pin.lat, pin.lon] as LatLngExpression}
            pathOptions={{ color: '#58a9ef', fillColor: '#58a9ef', fillOpacity: 0.7 }}
            radius={7}
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
