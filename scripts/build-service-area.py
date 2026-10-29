"""Rebuild bundled coverage from public source downloads (no runtime lookup).

Input folder: adm2.zip (geoBoundaries PHL ADM2, revision 41af8f1),
water-osm.json (Overpass `out geom` JSON).
See docs/service-area.md for provenance, queries and map limitations.
"""
import json
import pathlib
import sys
import zipfile

source = pathlib.Path(sys.argv[1])
root = pathlib.Path(__file__).resolve().parents[1]


def distance2(p, a, b):
    # Local metric approximation; Pangasinan spans less than one latitude degree.
    p, a, b = [(x * 106900, y * 111320) for x, y in (p, a, b)]
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx+dy*dy))) if dx or dy else 0
    return (p[0]-a[0]-t*dx)**2 + (p[1]-a[1]-t*dy)**2


def simplify(points, tolerance):
    keep = {0, len(points)-1}
    stack = [(0, len(points)-1)]
    while stack:
        start, end = stack.pop()
        farthest, deviation = start, tolerance*tolerance
        for i in range(start+1, end):
            value = distance2(points[i], points[start], points[end])
            if value > deviation:
                farthest, deviation = i, value
        if farthest != start:
            keep.add(farthest)
            stack.extend([(start, farthest), (farthest, end)])
    return [[round(x, 6), round(y, 6)] for i, (x, y) in enumerate(points) if i in keep]


def polygon(rings, tolerance):
    rings = [simplify(ring, tolerance) for ring in rings]
    if not rings or len(rings[0]) < 4:
        return None
    rings = [r for r in rings if len(r) >= 4]
    exterior = rings[0]
    return dict(bounds=[min(p[0] for p in exterior), min(p[1] for p in exterior), max(p[0] for p in exterior), max(p[1] for p in exterior)], rings=rings)


if (source / 'province-detailed.json').exists():
    feature = json.loads((source / 'province-detailed.json').read_text())
    assert feature['properties']['shapeName'] == 'Pangasinan'
else:
    with zipfile.ZipFile(source / 'adm2.zip') as archive:
        name = next(n for n in archive.namelist() if n.endswith('ADM2.geojson'))
        with archive.open(name) as f:
            provinces = json.load(f)
    feature = next(f for f in provinces['features'] if f['properties']['shapeName'] == 'Pangasinan')
    del provinces
coordinates = feature['geometry']['coordinates']
land = [p for rings in coordinates if (p := polygon(rings, 3))]
del feature, coordinates


def inside(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            result = not result
    return result


def assemble(parts):
    rings = []
    while parts:
        ring = parts.pop()
        while ring[0] != ring[-1]:
            for i, part in enumerate(parts):
                if ring[-1] == part[0]:
                    ring.extend(part[1:]); parts.pop(i); break
                if ring[-1] == part[-1]:
                    ring.extend(part[-2::-1]); parts.pop(i); break
            else:
                raise ValueError('Unclosed OSM water relation; refresh source data')
        rings.append(ring)
    return rings


water_source = json.loads((source / 'water-osm.json').read_text())
if water_source.get('remark'):
    raise ValueError(water_source['remark'])
water, members = [], set()
for item in water_source['elements']:
    if item['type'] != 'relation':
        continue
    parts = {'outer': [], 'inner': []}
    for member in item.get('members', []):
        if member['type'] == 'way' and member.get('geometry'):
            role = member.get('role') or 'outer'
            if role in parts:
                parts[role].append([[p['lon'], p['lat']] for p in member['geometry']])
                members.add(member['ref'])
    outer, inner = assemble(parts['outer']), assemble(parts['inner'])
    for ring in outer:
        water.append(polygon([ring] + [hole for hole in inner if inside(hole[0], ring)], 1))
for item in water_source['elements']:
    if item['type'] == 'way' and item['id'] not in members and item.get('geometry') and item['nodes'][0] == item['nodes'][-1]:
        water.append(polygon([[[p['lon'], p['lat']] for p in item['geometry']]], 1))
west, south, east, north = 119.749, 15.617, 120.922, 16.445
water = [p for p in water if p and p['bounds'][0] <= east and p['bounds'][2] >= west and p['bounds'][1] <= north and p['bounds'][3] >= south]
def encode(points):
    result, previous = [], [0, 0]
    for point in points:
        for axis in range(2):
            value = round(point[axis] * 1000000)
            delta = value - previous[axis]
            previous[axis] = value
            delta = ~(delta << 1) if delta < 0 else delta << 1
            while delta >= 32:
                result.append(chr((32 | (delta & 31)) + 63))
                delta >>= 5
            result.append(chr(delta + 63))
    return ''.join(result)
for item in land + water:
    item['rings'] = [encode(ring) for ring in item['rings']]
data = dict(version=1, encoding='delta polyline, longitude then latitude, precision 6', province='Pangasinan (including Dagupan)', boundaryRevision='41af8f1', osmTimestamp=water_source['osm3s']['timestamp_osm_base'], land=land, water=water)
target = root / 'public/service-area-data.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(data, separators=(',', ':')) + '\n')
print(dict(land=len(land), water=len(water), bytes=target.stat().st_size))
