// Minimal ambient types for the small slice of the Google Maps JavaScript
// API this project uses (Places Autocomplete + Geocoding). This avoids
// pulling in the full @types/google.maps package just for a few calls.
// If you later need more of the API, `npm install -D @types/google.maps`
// and delete this file instead.

declare namespace google.maps {
  interface LatLng {
    lat(): number;
    lng(): number;
  }

  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  interface MapsEventListener {
    remove(): void;
  }

  interface MapOptions {
    center?: LatLngLiteral;
    zoom?: number;
    disableDefaultUI?: boolean;
    zoomControl?: boolean;
    fullscreenControl?: boolean;
    mapTypeControl?: boolean;
    streetViewControl?: boolean;
    gestureHandling?: string;
  }

  class Map {
    constructor(el: HTMLElement, opts?: MapOptions);
    panTo(latLng: LatLngLiteral): void;
    setZoom(zoom: number): void;
    getCenter(): LatLng;
    getBounds(): LatLngBounds | undefined;
    fitBounds(bounds: LatLngBounds, padding?: number): void;
  }

  class LatLngBounds {
    constructor();
    extend(point: LatLngLiteral): LatLngBounds;
    contains(point: LatLngLiteral): boolean;
  }

  interface MarkerLabel {
    text: string;
    color?: string;
    fontSize?: string;
    fontWeight?: string;
  }

  interface MarkerOptions {
    position?: LatLngLiteral;
    map?: Map;
    draggable?: boolean;
    visible?: boolean;
    label?: string | MarkerLabel;
    title?: string;
    zIndex?: number;
    icon?: Symbol;
  }

  class Marker {
    constructor(opts?: MarkerOptions);
    addListener(eventName: "dragend", handler: () => void): MapsEventListener;
    getPosition(): LatLng | null | undefined;
    setPosition(pos: LatLngLiteral): void;
    setVisible(visible: boolean): void;
    setMap(map: Map | null): void;
  }

  enum SymbolPath {
    FORWARD_CLOSED_ARROW,
  }

  interface Symbol {
    path: SymbolPath;
    fillColor?: string;
    fillOpacity?: number;
    strokeColor?: string;
    strokeWeight?: number;
    scale?: number;
  }

  interface PolylineOptions {
    path?: LatLngLiteral[];
    map?: Map;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
  }

  class Polyline {
    constructor(opts?: PolylineOptions);
    setMap(map: Map | null): void;
  }

  namespace places {
    interface PlaceResult {
      name?: string;
      formatted_address?: string;
      geometry?: {
        location?: LatLng;
      };
    }

    interface AutocompleteOptions {
      fields?: string[];
      types?: string[];
      componentRestrictions?: { country: string | string[] };
    }

    class Autocomplete {
      constructor(input: HTMLInputElement, opts?: AutocompleteOptions);
      addListener(eventName: "place_changed", handler: () => void): MapsEventListener;
      getPlace(): PlaceResult;
    }
  }

  namespace Geocoder {
    // placeholder namespace merge target
  }

  interface GeocoderResult {
    formatted_address: string;
    geometry: { location: LatLng };
  }

  type GeocoderStatus = string;

  class Geocoder {
    geocode(
      request: { location: { lat: number; lng: number } },
      callback: (results: GeocoderResult[] | null, status: GeocoderStatus) => void,
    ): void;
  }
}

interface Window {
  google: typeof google;
}
