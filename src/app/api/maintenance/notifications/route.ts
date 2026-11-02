import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/db';
import {refreshOperationalSignals} from '@/lib/staff-notifications';
export async function GET(req:NextRequest){
 const secret=process.env.CRON_SECRET,actual=Buffer.from(req.headers.get('authorization')??''),expected=Buffer.from(`Bearer ${secret}`);
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{await refreshOperationalSignals(db);return NextResponse.json({ok:true,checkedAt:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}});}catch{return NextResponse.json({error:'Notification monitoring is unavailable.'},{status:503});}
}
