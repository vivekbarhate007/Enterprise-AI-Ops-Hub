export type StoredAuthSession = {
  access_token: string;
  expires_at: string;
  user: {
    email: string;
    role: string;
  };
};

const STORAGE_KEY = "aiops-auth-session";

export function readStoredAuthSession(): StoredAuthSession | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as StoredAuthSession;
  if (!session.expires_at || Date.parse(session.expires_at) <= Date.now()) {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return session;
}

export function logout() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export async function login(email: string, password: string) {
  return { email, password };
}
