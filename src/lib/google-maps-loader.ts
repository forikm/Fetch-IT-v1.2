// Loads the Google Maps JavaScript API (with the Places + Geocoding
// libraries) exactly once, no matter how many components ask for it.
// Every component that needs autocomplete or reverse-geocoding should
// call `loadGoogleMaps()` and await it before touching `window.google`.
//
// We use Google's `callback=` bootstrap parameter rather than plain
// script `onload` + `loading=async`. With `loading=async`, the script
// tag can fire its `onload` event slightly before window.google.maps.places
// is actually populated, which caused a "Cannot read properties of
// undefined (reading 'Autocomplete')" race. The `callback` parameter is
// guaranteed by Google to fire only once every requested library is
// fully ready, so it removes that race entirely.

declare global {
  interface Window {
    google: typeof google;
    __googleMapsLoaderPromise__?: Promise<void>;
    __onGoogleMapsLoaded__?: () => void;
  }
}

const SCRIPT_ID = "google-maps-js-sdk";
const CALLBACK_NAME = "__onGoogleMapsLoaded__";

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadGoogleMaps() can only run in the browser."));
  }

  // Already loaded.
  if (window.google?.maps?.places) {
    return Promise.resolve();
  }

  // Already loading — reuse the same promise so we never inject the
  // script twice.
  if (window.__googleMapsLoaderPromise__) {
    return window.__googleMapsLoaderPromise__;
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(
      new Error(
        "Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Add it to your .env (and to Vercel's Environment Variables) to enable address autocomplete.",
      ),
    );
  }

  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        document.getElementById(SCRIPT_ID)?.remove();
        reject(error);
      } else resolve();
    };
    const timer = setTimeout(() => finish(new Error("Map services took too long to load.")), 15000);
    window[CALLBACK_NAME] = () => window.google?.maps?.places
      ? finish() : finish(new Error("Address search is unavailable."));
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("error", () => finish(new Error("Map services couldn’t load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(apiKey) + "&libraries=places&callback=" + CALLBACK_NAME;
    script.async = true;
    script.defer = true;
    script.onerror = () => finish(new Error("Map services couldn’t load."));
    document.head.appendChild(script);
  });
  const shared = promise.catch(error => {
    if (window.__googleMapsLoaderPromise__ === shared) window.__googleMapsLoaderPromise__ = undefined;
    throw error;
  });
  window.__googleMapsLoaderPromise__ = shared;
  return shared;
}
