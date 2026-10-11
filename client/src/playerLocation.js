export function getPlayerCoordinates(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve) => {
    if (!geolocation) return resolve({});
    try {
      geolocation.getCurrentPosition(({ coords }) => {
        const { latitude: lat, longitude: lng } = coords || {};
        const valid = typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
          && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180;
        resolve(valid ? { lat, lng } : {});
      }, () => resolve({}), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    } catch {
      resolve({});
    }
  });
}
