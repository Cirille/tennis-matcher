const sessionKey = (clubId) => `tennis_session:${encodeURIComponent(clubId)}`;

export function readPlayerSession(clubId, storage = sessionStorage) {
  try {
    const value = JSON.parse(storage.getItem(sessionKey(clubId)));
    if (!value || typeof value !== 'object') return null;
    const { joinToken, sessionId, sessionToken } = value;
    if (typeof joinToken !== 'string' && !(typeof sessionId === 'string' && typeof sessionToken === 'string')) return null;
    return value;
  } catch {
    return null;
  }
}

export function savePlayerSession(clubId, credentials, storage = sessionStorage) {
  storage.setItem(sessionKey(clubId), JSON.stringify(credentials));
}

export function clearPlayerSession(clubId, storage = sessionStorage) {
  storage.removeItem(sessionKey(clubId));
}
