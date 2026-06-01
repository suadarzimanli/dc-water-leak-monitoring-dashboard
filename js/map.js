import { DC_ZONES } from "./zones.js";

function priorityClass(priority) {
  return priority === "high" ? "priority-high" : "priority-standard";
}

export function createDcMap(containerId, onZoneSelect) {
  const map = L.map(containerId, {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView([38.9072, -77.0369], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const markers = new Map();
  let selectedZoneId = null;

  for (const zone of DC_ZONES) {
    const icon = L.divIcon({
      className: "",
      html: `<div class="zone-marker normal ${priorityClass(zone.priority)}" data-zone="${zone.id}">
        <span class="zone-marker-maint hidden" title="Scheduled maintenance">🔧</span>
      </div>`,
      iconSize: zone.priority === "high" ? [22, 22] : [18, 18],
      iconAnchor: zone.priority === "high" ? [11, 11] : [9, 9],
    });

    const marker = L.marker([zone.lat, zone.lng], { icon }).addTo(map);
    marker.bindPopup(
      `<strong>${zone.id}</strong><br>${zone.name}<br>` +
        `<em>${zone.dma}</em><br>` +
        `Priority: ${zone.priority === "high" ? "High" : "Standard"}`
    );
    marker.on("click", () => onZoneSelect(zone.id));
    markers.set(zone.id, marker);
  }

  function getMarkerEl(zoneId) {
    const marker = markers.get(zoneId);
    return marker?.getElement()?.querySelector(".zone-marker") ?? null;
  }

  return {
    map,
    markers,
    setMarkerRisk(zoneId, risk) {
      const el = getMarkerEl(zoneId);
      if (!el) return;
      el.classList.remove("normal", "warning", "critical");
      el.classList.add(risk);
    },
    setMaintenanceBadge(zoneId, visible) {
      const el = getMarkerEl(zoneId);
      const badge = el?.querySelector(".zone-marker-maint");
      if (!badge) return;
      badge.classList.toggle("hidden", !visible);
    },
    setSelected(zoneId) {
      if (selectedZoneId) {
        getMarkerEl(selectedZoneId)?.classList.remove("selected");
      }
      selectedZoneId = zoneId;
      if (zoneId) {
        getMarkerEl(zoneId)?.classList.add("selected");
      }
    },
    focusZone(zoneId) {
      const zone = DC_ZONES.find((z) => z.id === zoneId);
      const marker = markers.get(zoneId);
      if (!zone || !marker) return;
      map.setView([zone.lat, zone.lng], 14, { animate: true });
      marker.openPopup();
      this.setSelected(zoneId);
    },
  };
}
