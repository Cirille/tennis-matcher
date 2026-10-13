export const API_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);

export async function api(path, token, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`${API_URL}/api${path}`, {
    method, signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'Request failed'); error.status = response.status; throw error; }
  return result;
}
