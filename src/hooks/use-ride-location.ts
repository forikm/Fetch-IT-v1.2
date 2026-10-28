"use client";

import { useEffect, useState } from "react";

type Location = { lat: number; lng: number };

// Device location stays in this view and is never sent to the booking API.
export function useRideLocation(enabled: boolean) {
  const [location, setLocation] = useState<Location | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;
    let closed = false;
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (closed) return;
        setLocation({ lat: coords.latitude, lng: coords.longitude });
        setError("");
      },
      (failure) => {
        if (closed) return;
        setLocation(null);
        setError(failure.code === 1
          ? "Location access is off. Allow location in your browser settings to see where you are. Pickup and drop-off are still shown."
          : "Your current location is unavailable. Pickup and drop-off are still shown.");
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
    return () => { closed = true; navigator.geolocation.clearWatch(watch); };
  }, [enabled]);

  return {
    location: enabled ? location : null,
    message: !enabled ? "" : typeof navigator !== "undefined" && !navigator.geolocation
      ? "This browser cannot share your location. Pickup and drop-off are still shown."
      : error || (location ? "Your current location is marked in blue." : "Allow location access to see where you are on the map. Pickup and drop-off are shown while we locate you."),
  };
}
