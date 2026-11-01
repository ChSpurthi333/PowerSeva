// Distance in kilometres between two latitude/longitude points (haversine formula)
function haversineKm(lat1, lon1, lat2, lon2) {
  const nums = [lat1, lon1, lat2, lon2].map(Number);
  if (nums.some((n) => Number.isNaN(n)) || [lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || v === '')) return null;
  const [a1, o1, a2, o2] = nums;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(a2 - a1);
  const dLon = rad(o2 - o1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

module.exports = { haversineKm };
