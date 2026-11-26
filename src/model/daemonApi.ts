// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

/**
 * JSON over the host site's board API (`apiBase`): the Pi daemon's routes
 * (`/designs`) and the site's own (`/library`). Shared by fpgaDesigns.ts and
 * fpgaLibrary.ts, so neither imports the other's request plumbing.
 */

export class DaemonError extends Error {
  constructor(
    public error: string,
    public detail: string,
    public status: number,
  ) {
    super(detail ? `${error}: ${detail}` : error);
  }
}

/** `/api/board/x/` and `/api/board/x` must build the same URLs. */
export function normaliseApiBase(apiBase: string) {
  return apiBase.replace(/\/+$/, '');
}

let csrfToken: (() => string) | undefined;

/**
 * Set (or clear, with `undefined`) the host page's CSRF token getter. While
 * set, every non-GET daemon request sends `X-CSRFToken: fn()`; the getter is
 * called per request so a rotated token is picked up.
 */
export function setCsrfToken(fn: (() => string) | undefined): void {
  csrfToken = fn;
}

export async function daemonJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(csrfToken && method !== 'GET' ? { 'X-CSRFToken': csrfToken() } : {}),
    // Callers here only ever pass plain-object headers.
    ...(init?.headers as Record<string, string> | undefined),
  };
  const response = await fetch(url, { ...init, headers });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const b = (body ?? {}) as { error?: string; detail?: string };
    throw new DaemonError(b.error ?? `HTTP ${response.status}`, b.detail ?? '', response.status);
  }
  return body as T;
}
