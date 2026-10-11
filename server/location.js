const https = require('node:https');
const { coordinates: validCoordinates } = require('./validation');
function locationTools(logger) {
  // Map extractors
  const extractLatLng = (urlStr) => {
    const regex = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
    const match = urlStr.match(regex);
    if (match) {
      const coords = { lat: Number(match[1]), lng: Number(match[2]) };
      if (validCoordinates(coords.lat, coords.lng)) return coords;
    }
    return null;
  };
  const resolveMapLink = async (urlStr) => {
    try {
      const url = new URL(urlStr);
      const mapHosts = new Set(['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl']);
      if (url.protocol !== 'https:' || !mapHosts.has(url.hostname) || url.username || url.password) return null;
      const directCoords = extractLatLng(urlStr);
      if (directCoords) return directCoords;
      return await new Promise((resolve) => {
        const request = https.get(url, { timeout: 3000 }, (res) => {
          res.resume();
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            try {
              const target = new URL(res.headers.location, url);
              if (target.protocol === 'https:' && mapHosts.has(target.hostname)) {
                const coords = extractLatLng(target.href);
                if (coords) return resolve(coords);
              }
            } catch {
              return resolve(null);
            }
          }
          resolve(null);
        });
        request.on('error', (e) => {
          logger.error(`Map resolution error: ${e.message}`);
          resolve(null);
        });
        request.on('timeout', () => {
          request.destroy();
          logger.warn(`Map resolution request timed out for url: ${urlStr}`);
          resolve(null);
        });
      });
    } catch (e) {
      logger.error(`Map resolution exception: ${e.message}`);
      return null;
    }
  };

  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI/180);
    const dLon = (lon2 - lon1) * (Math.PI/180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };


return { resolveMapLink, getDistanceFromLatLonInKm };
}
module.exports = { locationTools };
