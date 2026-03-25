"use client";

import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type ExtraMarker = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
};

type AlarmMapProps = {
  latitude: number;
  longitude: number;
  title?: string;
  subtitle?: string;
  extraMarkers?: ExtraMarker[];
};

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export default function AlarmMap({
  latitude,
  longitude,
  title = "Alarm location",
  subtitle = "",
  extraMarkers = [],
}: AlarmMapProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/20">
      <MapContainer
        center={[latitude, longitude]}
        zoom={16}
        scrollWheelZoom={true}
        style={{ height: "320px", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={[latitude, longitude]} icon={markerIcon}>
          <Popup>
            <strong>{title}</strong>
            <br />
            {subtitle}
            <br />
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </Popup>
        </Marker>

        {extraMarkers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.latitude, marker.longitude]}
            icon={markerIcon}
          >
            <Popup>
              <strong>{marker.title}</strong>
              <br />
              {marker.subtitle || ""}
              <br />
              {marker.latitude.toFixed(5)}, {marker.longitude.toFixed(5)}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
