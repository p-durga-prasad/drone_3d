import { useEffect, useRef } from "react";
import L from "leaflet";
import { store } from "../store/telemetryStore";
import { classColor } from "../utils/classColors";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const OSM_TILE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const DEFAULT_CENTER = [17.417393, 78.428228];
const DEFAULT_ZOOM   = 17;

// Sizes per class
const DOT_SIZE = { four_wheeler: 13, two_wheeler: 10, three_wheeler: 11, six_plus_wheeler: 15, person: 9, unknown: 9 };

function makeObjectIcon(cls) {
  const color = classColor(cls);
  const size  = DOT_SIZE[cls] ?? 10;
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;">
        <div style="
          position:absolute;inset:0;
          background:${color};opacity:0.3;
          border-radius:50%;
          animation:obj-ping 1.8s ease-out infinite;
        "></div>
        <div style="
          position:absolute;inset:2px;
          background:${color};
          border:2px solid white;
          border-radius:50%;
          box-shadow:0 0 6px ${color}99;
        "></div>
      </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeDroneIcon() {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:28px;height:28px;">
        <div style="
          position:absolute;inset:-6px;
          background:#ef444433;
          border-radius:50%;
          animation:drone-ring 1.4s ease-out infinite;
        "></div>
        <div style="
          position:absolute;inset:0;
          background:linear-gradient(135deg,#ef4444,#dc2626);
          border:3px solid white;
          border-radius:50%;
          box-shadow:0 0 12px #ef444488;
          display:flex;align-items:center;justify-content:center;
          font-size:13px;line-height:1;
        ">🚁</div>
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function makePopupHtml(o) {
  const color = classColor(o.cls);
  const confColor = o.confidence >= 0.7 ? "#22c55e" : o.confidence >= 0.4 ? "#f59e0b" : "#ef4444";
  return `
    <div class="tel-popup">
      <div class="tel-popup-head">
        <span class="tel-popup-dot" style="background:${color};box-shadow:0 0 6px ${color}99;"></span>
        <span class="tel-popup-title">ID ${o.track_id}</span>
        <span class="tel-popup-badge" style="background:${color}22;color:${color};">${o.cls.replace(/_/g, " ")}</span>
      </div>
      <div class="tel-popup-row">
        <span class="tel-popup-label">Confidence</span>
        <span class="tel-popup-value" style="color:${confColor};">${(o.confidence * 100).toFixed(0)}%</span>
      </div>
      <div class="tel-popup-row">
        <span class="tel-popup-label">Lat</span>
        <span class="tel-popup-value tel-popup-mono">${o.lat.toFixed(6)}</span>
      </div>
      <div class="tel-popup-row">
        <span class="tel-popup-label">Lng</span>
        <span class="tel-popup-value tel-popup-mono">${o.lng.toFixed(6)}</span>
      </div>
    </div>`;
}

function makeDronePopupHtml(d) {
  return `
    <div class="tel-popup">
      <div class="tel-popup-head">
        <span class="tel-popup-emoji">🚁</span>
        <span class="tel-popup-title">Drone</span>
      </div>
      <div class="tel-popup-row">
        <span class="tel-popup-label">Altitude</span>
        <span class="tel-popup-value">${parseFloat(d.alt).toFixed(1)} m</span>
      </div>
      <div class="tel-popup-row">
        <span class="tel-popup-label">Heading</span>
        <span class="tel-popup-value">${parseFloat(d.heading).toFixed(1)}°</span>
      </div>
      <div class="tel-popup-row">
        <span class="tel-popup-label">Lat</span>
        <span class="tel-popup-value tel-popup-mono">${parseFloat(d.lat).toFixed(6)}</span>
      </div>
      <div class="tel-popup-row">
        <span class="tel-popup-label">Lng</span>
        <span class="tel-popup-value tel-popup-mono">${parseFloat(d.lng).toFixed(6)}</span>
      </div>
    </div>`;
}

export default function DroneMap() {
  const containerRef   = useRef(null);
  const mapRef         = useRef(null);
  const droneMarkerRef = useRef(null);
  const footprintRef   = useRef(null);
  const objectLayerRef = useRef(new Map()); // track_id -> { marker, cls }
  const rafRef         = useRef(null);
  const hasCenteredRef = useRef(false);

  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
    });

    L.tileLayer(OSM_TILE, { attribution: OSM_ATTR, maxZoom: 20 }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapRef.current = map;

    // Drone marker
    droneMarkerRef.current = L.marker(DEFAULT_CENTER, {
      icon: makeDroneIcon(),
      zIndexOffset: 2000,
    })
      .bindPopup(() => (store.drone ? makeDronePopupHtml(store.drone) : "Drone"), {
        closeButton: true,
        autoClose: false,
        closeOnClick: false,
      })
      .addTo(map);

 

    // Camera footprint polygon
    footprintRef.current = L.polygon([], {
      color: "#facc15",
      weight: 2,
      fillColor: "#fde68a",
      fillOpacity: 0.07,
      dashArray: "8 5",
    }).addTo(map);

    // Clicking anywhere on the map that isn't a marker closes all open popups
    map.on("click", () => {
      map.closePopup();
    });

    // rAF render loop — reads mutable store directly, no setState
    function renderLoop() {
      rafRef.current = requestAnimationFrame(renderLoop);

      if (store.drone) {
        const { lat, lng } = store.drone;
        droneMarkerRef.current.setLatLng([lat, lng]);
        if (droneMarkerRef.current.isPopupOpen()) {
          droneMarkerRef.current.setPopupContent(makeDronePopupHtml(store.drone));
        }
        if (!hasCenteredRef.current) {
          map.setView([lat, lng], DEFAULT_ZOOM);
          hasCenteredRef.current = true;
        }
      }

      if (store.footprint) {
        footprintRef.current.setLatLngs(store.footprint.map((p) => [p.lat, p.lng]));
      }

      const activeIds = new Set();
      store.objects.forEach((obj, id) => {
        activeIds.add(id);
        const entry = objectLayerRef.current.get(id);
        if (entry) {
          entry.marker.setLatLng([obj.lat, obj.lng]);
          if (entry.marker.isPopupOpen()) {
            entry.marker.setPopupContent(makePopupHtml(obj));
          }
          // Re-create icon only if class changed
          if (entry.cls !== obj.cls) {
            entry.marker.setIcon(makeObjectIcon(obj.cls));
            entry.cls = obj.cls;
          }
        } else {
          const marker = L.marker([obj.lat, obj.lng], {
            icon: makeObjectIcon(obj.cls),
            zIndexOffset: 100,
          })
            .bindPopup(() => makePopupHtml(store.objects.get(id) ?? obj), {
              closeButton: true,
              autoClose: false,
              closeOnClick: false,
              className: "obj-popup",
            })
            .addTo(map);

     

          objectLayerRef.current.set(id, { marker, cls: obj.cls });
        }
      });

      objectLayerRef.current.forEach((entry, id) => {
        if (!activeIds.has(id)) {
          entry.marker.remove();
          objectLayerRef.current.delete(id);
        }
      });
    }

    renderLoop();

    return () => {
      cancelAnimationFrame(rafRef.current);
      objectLayerRef.current.forEach((e) => e.marker.remove());
      objectLayerRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" style={{ zIndex: 0 }} />;
}