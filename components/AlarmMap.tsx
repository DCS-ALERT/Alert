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
  kind?: "user" | "alarm" | "acknowledged";
  label?: string;
};

type AlarmMapProps = {
  latitude: number;
  longitude: number;
  title?: string;
  subtitle?: string;
  kind?: "user" | "alarm" | "acknowledged";
  label?: string;
  extraMarkers?: ExtraMarker[];
};

const redIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconRetinaUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const yellowIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-gold.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconRetinaUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function createNumberedUserIcon(label: string) {
  return L.divIcon({
    className: "custom-numbered-user-marker",
    html: `
      <div style="
        width: 28px;
        height: 28px;
        border-radius: 9999px;
        background: #16a34a;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 700;
        font-size: 12px;
        line-height: 1;
        text-align: center;
      ">
        <span>${label}</span>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function getMarkerIcon(
  kind: "user" | "alarm" | "acknowledged" = "user",
  label?: string
) {
  if (kind === "alarm") return redIcon;
  if (kind === "acknowledged") return yellowIcon;
  return createNumberedUserIcon(String(label ?? ""));
}

export default function AlarmMap({
  latitude,
  longitude,
  title = "Location",
  subtitle = "",
  kind = "alarm",
  label,
  extraMarkers = [],
}: AlarmMapProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/20">
      <MapContainer
        center={[latitude, longitude]}
        zoom={16}
        scrollWheelZoom={true}
        style={{ height: "360px", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker
          position={[latitude, longitude]}
          icon={getMarkerIcon(kind, label)}
        >
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
            icon={getMarkerIcon(marker.kind || "user", marker.label)}
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
