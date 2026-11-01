/* ===== PowerSeva - map helpers (Leaflet + OpenStreetMap, heatmap plugin) ===== */
const DEFAULT_CENTER = [16.3067, 80.4365]; // Guntur, Andhra Pradesh

const MapKit = {
  ready() { return typeof L !== 'undefined'; },

  // Creates a map in the element with the given id; shows a message if the map library could not load
  create(id, center, zoom) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (!MapKit.ready()) {
      el.innerHTML = `<div class="empty">${esc(t('The map could not be loaded. Check your internet connection.'))}</div>`;
      return null;
    }
    const map = L.map(id, { scrollWheelZoom: false }).setView(center || DEFAULT_CENTER, zoom || 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());
    return map;
  },

  // Click-to-place marker bound to two inputs (latitude, longitude)
  picker(id, latInput, lngInput, onChange) {
    const lat0 = Number(latInput.value);
    const lng0 = Number(lngInput.value);
    const has = lat0 && lng0;
    const map = MapKit.create(id, has ? [lat0, lng0] : DEFAULT_CENTER, has ? 15 : 11);
    if (!map) return null;
    let marker = null;
    const put = (lat, lng, pan) => {
      latInput.value = Number(lat).toFixed(7);
      lngInput.value = Number(lng).toFixed(7);
      if (marker) marker.setLatLng([lat, lng]); else {
        marker = L.marker([lat, lng], { draggable: true }).addTo(map);
        marker.on('dragend', () => { const p = marker.getLatLng(); put(p.lat, p.lng, false); });
      }
      if (pan) map.setView([lat, lng], Math.max(map.getZoom(), 15));
      if (onChange) onChange(lat, lng);
    };
    map.on('click', (e) => put(e.latlng.lat, e.latlng.lng, false));
    if (has) put(lat0, lng0, false);
    return { map, put };
  },

  // Heatmap + circle markers for complaint points
  heat(map, points) {
    if (!map || !MapKit.ready()) return null;
    const layer = L.layerGroup().addTo(map);
    if (typeof L.heatLayer === 'function' && points.length) {
      L.heatLayer(points.map((p) => [p.lat, p.lng, p.weight || 1]), {
        radius: 28, blur: 22, maxZoom: 14, minOpacity: 0.35,
        gradient: { 0.2: '#4aa3df', 0.4: '#7cc576', 0.6: '#f2c200', 0.8: '#f08a24', 1.0: '#d93025' }
      }).addTo(layer);
    }
    points.forEach((p) => {
      L.circleMarker([p.lat, p.lng], { radius: 4, weight: 1, color: '#0b5cad', fillColor: '#fff', fillOpacity: 0.9 })
        .bindPopup(`<b>${esc(p.number)}</b><br>${esc(t(p.fault_type))}<br>${esc(label(p.priority))}<br>${esc(p.area || '')}`)
        .addTo(layer);
    });
    if (points.length) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 13 });
    return layer;
  },

  // Asks the browser for the device position
  locate(onOk, onFail) {
    if (!navigator.geolocation) { toast(t('Location is not supported by your browser'), 'error'); if (onFail) onFail(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => onOk(pos.coords.latitude, pos.coords.longitude),
      () => { toast(t('Could not get your location'), 'error'); if (onFail) onFail(); },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }
};

/* ----- "My profile": phone, village / area and map position (used for outage alerts and technician distance) ----- */
async function openProfile(onSaved) {
  const user = Auth.user;
  if (!user) return;
  const isTech = user.role === 'technician';
  const body = openModal(`
    <h2>${esc(t('My profile'))}</h2>
    <p class="muted mb">${esc(isTech
      ? t('Your base location is used to send you the nearest jobs.')
      : t('Your village or area is used to send you power outage alerts near you.'))}</p>
    <div class="form-row">
      <div class="form-group"><label for="pf-phone">${esc(t('Phone'))}</label><input id="pf-phone" type="tel" value="${esc(user.phone || '')}"></div>
      <div class="form-group"><label for="pf-area">${esc(t('Village / town / area'))}</label>
        <input id="pf-area" list="pf-areas" maxlength="100" value="${esc(user.area || '')}" data-voice><datalist id="pf-areas"></datalist></div>
    </div>
    ${isTech ? `<div class="form-group"><label><input type="checkbox" id="pf-avail" ${user.is_available === false ? '' : 'checked'}>${esc(t('I am available for new jobs'))}</label></div>` : ''}
    <div class="form-group">
      <label>${esc(isTech ? t('Base location (click the map)') : t('My location (click the map)'))}</label>
      <div class="inline-row"><button type="button" class="btn btn-outline btn-sm" id="pf-geo">${esc(t('Use my current location'))}</button>
      <span class="muted" id="pf-status"></span></div>
      <div id="pf-map" class="map map-sm"></div>
      <input type="hidden" id="pf-lat" value="${user.latitude ?? ''}"><input type="hidden" id="pf-lng" value="${user.longitude ?? ''}">
    </div>
    <button class="btn" id="pf-save">${esc(t('Save profile'))}</button>`);

  api('/complaints/areas').then((list) => {
    body.querySelector('#pf-areas').innerHTML = list.map((a) => `<option value="${esc(a)}">`).join('');
  }).catch(() => {});

  const lat = body.querySelector('#pf-lat');
  const lng = body.querySelector('#pf-lng');
  const status = body.querySelector('#pf-status');
  const pick = MapKit.picker('pf-map', lat, lng, () => { status.textContent = t('Location captured'); });
  setTimeout(() => { if (pick) pick.map.invalidateSize(); }, 250);
  body.querySelector('#pf-geo').addEventListener('click', () =>
    MapKit.locate((a, b) => { if (pick) pick.put(a, b, true); else { lat.value = a; lng.value = b; } }));

  body.querySelector('#pf-save').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const payload = {
        phone: body.querySelector('#pf-phone').value.trim(),
        area: body.querySelector('#pf-area').value.trim(),
        latitude: lat.value || null,
        longitude: lng.value || null
      };
      if (isTech) payload.is_available = body.querySelector('#pf-avail').checked;
      const r = await api('/auth/profile', { method: 'PUT', body: payload });
      Auth.save(Auth.token, { ...user, ...r.user });
      closeModal();
      toast(t(r.message), 'success');
      if (onSaved) onSaved(r.user);
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false;
    }
  });
}
