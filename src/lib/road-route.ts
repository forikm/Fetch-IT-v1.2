export type RoadPoint = { lat: number; lng: number };
export type RoadRoute = { path: RoadPoint[]; warnings: string[] };
const pending = new Map<string, Promise<RoadRoute>>();
export function roadRouteKey(pickup: RoadPoint, dropoff: RoadPoint, vehicleClass = 'SEDAN') { return [pickup.lat,pickup.lng,dropoff.lat,dropoff.lng,vehicleClass].join(','); }
export function requestRoadRoute(pickup: RoadPoint, dropoff: RoadPoint, vehicleClass = 'SEDAN'): Promise<RoadRoute> {
 if ([pickup,dropoff].some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)) return Promise.reject(new Error('Invalid route locations.'));
 const key = roadRouteKey(pickup,dropoff,vehicleClass), existing=pending.get(key); if(existing)return existing;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 const request=(async()=>{
  const response=await fetch('/api/road-route',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({pickup,dropoff,vehicleClass})});
  const data=await response.json().catch(()=>null); if(!response.ok||!data?.route)throw new Error(data?.error||'Road route unavailable.');
  const points=data.route.coordinates;
  if(!Array.isArray(points)||points.length<2||points.some(p=>!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90))throw new Error('No road route found.');
  return {path:points.map(([lng,lat]:[number,number])=>({lat,lng})),warnings:vehicleClass==='SEDAN'?[]:['Uses a car road profile. Local motorcycle/tricycle restrictions still apply.']};
 })().finally(()=>{clearTimeout(timer);if(pending.get(key)===request)pending.delete(key);});
 pending.set(key,request);return request;
}
