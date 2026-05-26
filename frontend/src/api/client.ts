export const API_BASE_URLS = ["http://127.0.0.1:8000", "http://localhost:8000"] as const;

export function apiUrl(path: string, baseUrl = API_BASE_URLS[0]) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function parseApiJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), init);
}
