export type SavedPlace = {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  details?: string;
};

export function onboardingPending(userId: string): boolean {
  try { return localStorage.getItem(`fetchit:${userId}:onboarding-pending-v1`) === "1"; }
  catch { return false; }
}

export function setOnboardingPending(userId: string, pending: boolean) {
  try {
    const key = `fetchit:${userId}:onboarding-pending-v1`;
    if (pending) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch { /* The current session can still finish setup without storage. */ }
}

export function mergeSavedPlaces(previous: SavedPlace[], next: SavedPlace[]): SavedPlace[] {
  const names = new Set(next.map(place => place.name.trim().toLowerCase()));
  const ids = new Set(next.map(place => place.id));
  return [...previous.filter(place => !ids.has(place.id) && !names.has(place.name.trim().toLowerCase())), ...next].slice(-20);
}
