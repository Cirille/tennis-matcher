class UserError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') { super(message); this.status = status; this.code = code; }
}
const ensure = (condition, message, status, code) => { if (!condition) throw new UserError(message, status, code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const password = value => typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 72;
const coordinates = (lat, lng) => typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180;
const playerDetails = data => object(data) && text(data.name, 80) && Number.isInteger(Number(data.level)) && Number(data.level) >= 1 && Number(data.level) <= 10
  && ['M', 'F', 'Other'].includes(data.gender)
  && (data.customAvatar == null || (typeof data.customAvatar === 'string' && data.customAvatar.length <= 100000 && /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(data.customAvatar)));

// Bounded buckets, with expired entries evicted before capacity checks. Never store passwords/PINs.
function limiter(limit, windowMs, maxKeys = 10000) {
  const entries = new Map();
  const consume = key => {
    const now = Date.now();
    if (entries.size >= maxKeys) for (const [id, entry] of entries) if (entry.until <= now) entries.delete(id);
    let entry = entries.get(key);
    if (!entry || entry.until <= now) {
      if (!entry && entries.size >= maxKeys) throw new UserError('Too many requests. Please try again later.', 429, 'RATE_LIMIT');
      entry = { count: 0, until: now + windowMs };
      entries.set(key, entry);
    }
    ensure(++entry.count <= limit, 'Too many requests. Please try again later.', 429, 'RATE_LIMIT');
  };
  consume.check = key => {
    const entry = entries.get(key);
    ensure(!entry || entry.until <= Date.now() || entry.count < limit, 'Too many requests. Please try again later.', 429, 'RATE_LIMIT');
  };
  return consume;
}
module.exports = { UserError, ensure, object, text, email, password, coordinates, playerDetails, limiter };
