import { createHmac, timingSafeEqual } from 'node:crypto';
import { quoteFare, quoteRideFare, type Quote, type LatLng } from './fare';
import { type VehicleClass } from './constants';
import { type PlatformSettings } from './platform-policy';
import { sessionSecret } from './session-secret';
import { roadRoute, routingEnabled } from './road-routing-service';
import { RoutingError } from './road-routing';

type Input = { type: 'RIDE' | 'DELIVERY'; pickup: LatLng; dropoff: LatLng; vehicleClass: VehicleClass; cargoWeightKg?: number; passengers?: number; when?: Date; scheduledAt?: Date | null; settings: PlatformSettings };
function identity(uid: string, input: Input) {
  return JSON.stringify([uid, input.type, input.pickup.lat, input.pickup.lng, input.dropoff.lat, input.dropoff.lng, input.vehicleClass,
    input.type === 'RIDE' ? input.passengers ?? 1 : input.cargoWeightKg ?? 1, input.scheduledAt?.toISOString() ?? null]);
}
function signature(value: string) { return createHmac('sha256', sessionSecret()).update('road-quote-v1:' + value).digest(); }
type SignedQuote = { identity: string; expiresAt: number; quote: Quote; source: 'openrouteservice' | 'estimate' };
export function signRoadQuote(uid: string, input: Input, quote: Quote, source: SignedQuote['source'], now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ identity: identity(uid, input), expiresAt: now + 10 * 60000, quote, source })).toString('base64url');
  return payload + '.' + signature(payload).toString('base64url');
}
export function readRoadQuote(token: unknown, uid: string, input: Input, now = Date.now()): SignedQuote {
  const invalid = () => new RoutingError('QUOTE_EXPIRED', 'Your fare needs refreshing. Refresh the fare and review it before confirming.', 409);
  if (typeof token !== 'string' || token.length > 10000) throw invalid();
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra) throw invalid();
  const expected = signature(payload), actual = Buffer.from(supplied, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  let data: SignedQuote;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw invalid(); }
  if (data.identity !== identity(uid, input) || !Number.isFinite(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + 10 * 60000 || !data.quote?.fare || !['estimate', 'openrouteservice'].includes(data.source)) throw invalid();
  return data;
}
export async function newRoadQuote(uid: string, input: Input) {
  const route = routingEnabled() ? await roadRoute(input.pickup, input.dropoff, input.vehicleClass) : null;
  const params = { ...input, route: route ? { distanceKm: route.distanceMeters / 1000, durationSeconds: route.durationSeconds } : undefined };
  const quote = input.type === 'RIDE' ? quoteRideFare(params) : quoteFare({ ...params, cargoWeightKg: input.cargoWeightKg ?? 1 });
  const routingSource = route ? 'openrouteservice' as const : 'estimate' as const;
  return { ...quote, routingSource, routeQuote: signRoadQuote(uid, input, quote, routingSource) };
}
export async function confirmedRoadQuote(token: unknown, uid: string, input: Input) {
  if (token) return readRoadQuote(token, uid, input).quote;
  // Older clients remain compatible while routing is disabled. Once enabled,
  // require an explicit reviewed quote rather than silently changing the price.
  if (routingEnabled()) throw new RoutingError('QUOTE_REQUIRED', 'Refresh the fare before confirming this booking.', 409);
  return (await newRoadQuote(uid, input));
}
