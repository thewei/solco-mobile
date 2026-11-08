// The OS can launch Solco from a push while no React listener was mounted.
// Only a validated Assistant Activity route from the known push shape may
// navigate on cold start. Never execute notification actions during replay.
export function assistantPushRoute(data: Record<string, unknown> | null | undefined):
  { pathname: '/assistants/activity/[id]'; params: { id: string } } | null {
  const raw = data?.route;
  if (typeof raw !== 'string' || raw.length > 600) return null;
  try {
    const route: unknown = JSON.parse(raw);
    if (typeof route !== 'object' || route === null) return null;
    const candidate = route as Record<string, unknown>;
    if (candidate.pathname !== '/assistants/activity/[id]') return null;
    const params = candidate.params;
    if (typeof params !== 'object' || !params) return null;
    const id = (params as Record<string, unknown>).id;
    if (typeof id !== 'string' || !/^[a-z]_[A-Za-z0-9]{1,40}$/.test(id)) return null;
    return { pathname: '/assistants/activity/[id]', params: { id } };
  } catch {
    return null;
  }
}

// Public bootstrap hostId (first 16 hex digits of the Mac's pinned TLS
// fingerprint). An untrusted notification must never select an unknown Mac.
export function assistantPushHostId(data: Record<string, unknown> | null | undefined): string | null {
  const value = data?.hostId;
  return typeof value === 'string' && /^[0-9a-f]{16}$/i.test(value) ? value.toLowerCase() : null;
}
