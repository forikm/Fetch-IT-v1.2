# Pangasinan booking coverage

Customer pickup and drop-off must be on mapped land in Pangasinan, including Dagupan. Both rides and deliveries use the same coordinate check. Addresses and Google reverse-geocoder labels do not determine eligibility.

The booking form loads the coverage module only when opened, checks selected addresses, saved places, repeated bookings and map pins, and blocks continuation for unavailable locations. Fare estimation and booking creation independently return HTTP 422 with `SERVICE_UNAVAILABLE`. Successful online checkout also checks stored coordinates before creating a booking. Previously created bookings and idempotent retries that recover those bookings retain their original records.

## Data and attribution

- Province land geometry: [geoBoundaries PHL ADM2, revision 41af8f1](https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM2/), Pangasinan feature from the detailed GeoJSON. Sources: NAMRIA, PSA and OCHA Philippines; boundary year 2020. License: [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/). Modified by extracting Pangasinan, simplifying to 3 metres and rounding to six decimals. Dagupan is included in this geometry.
- Water polygons: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Snapshot `2026-07-15T15:22:01Z` via the public Overpass API. Includes closed ways and multipolygon relations for `natural=water` and `waterway=riverbank`, including mapped ponds, lakes and reservoirs. Simplified to 1 metre. Relation inner rings preserve islands.
- The combined derived data is distributed under ODbL in `public/service-area-data.json`, also publicly accessible at `/service-area-data.json`. The boundary attribution and its original license remain applicable. The booking form links both attribution sources and the downloadable derived database.

## Refreshing

Download `geoBoundaries-PHL-ADM2-all.zip` for revision `41af8f1` (or deliberately update the source version). Save it as `adm2.zip` in a working directory. Query Overpass, save its complete JSON response as `water-osm.json`, then run `python scripts/build-service-area.py <working-directory>`.

```text
[out:json][timeout:90];
(
  way["natural"="water"](15.5,119.7,16.55,121.0);
  relation["natural"="water"](15.5,119.7,16.55,121.0);
  way["waterway"="riverbank"](15.5,119.7,16.55,121.0);
  relation["waterway"="riverbank"](15.5,119.7,16.55,121.0);
);
out geom;
```

The generator refuses partial Overpass responses and unclosed relation rings. Geometry uses longitude, latitude order. Rings use delta polyline encoding with precision 6, longitude delta first, latitude delta second; decode using `src/lib/service-area.ts`. Polygon bounding boxes avoid decoding unrelated water areas. No external map query is made during coverage checks and no paid API was added.

## Limits

This is a static map snapshot, not real-time flood detection. Unmapped water, changed shorelines and boundary/GPS inaccuracies can affect a pin near an edge. Road bridges are not exempted: choose pickup and drop-off points on land beside the crossing. The public bridge source was unavailable during this release, so no bridge exceptions were fabricated. Route paths are not constrained by this endpoint restriction; it validates pickup and destination, not every road segment between them. Refresh the data periodically and review disputed pins before expanding coverage.

## Verification

Run `node --test tests/service-area.test.mjs tests/booking-confirm.test.mjs`. Tests cover valid Lingayen/Dagupan/Urdaneta/Alaminos locations, outside-province points, Lingayen Gulf, Pantal River, malformed coordinates, both pickup and destination, both services, server enforcement and saved-draft preservation. Use an isolated schema for browser and integration tests; never place production bookings to test this restriction.
