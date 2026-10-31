import type { Player } from '../shared/game';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Connection lost. Please try again.', 0);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(result.error || 'The request could not be completed.', response.status);
  return result as T;
}
export type PlayerResponse = { player: Player };
export interface Settings {
  sound: boolean;
  sensitivity: number;
  quality: 'high' | 'low';
}
export const defaultSettings: Settings = { sound: false, sensitivity: 1, quality: 'high' };
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be disabled; the game still works. */
  }
}
