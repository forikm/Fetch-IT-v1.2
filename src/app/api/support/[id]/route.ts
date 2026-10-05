import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CustomerError, requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { supportInput } from "@/lib/support-input";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    const { id } = await params;
    const ticket = await db.supportTicket.findFirst({ where: { id, customerId: session.uid },
      select: { id: true, category: true, status: true, message: true, createdAt: true, customerReadAt: true,
        booking: { select: { id: true, refCode: true, type: true } } } });
    if (!ticket) throw new CustomerError("Request not found.", 404);
    const cursor = request.nextUrl.searchParams.get("cursor");
    if (cursor && !await db.supportMessage.findFirst({ where: { id: cursor, ticketId: id }, select: { id: true } }))
      throw new CustomerError("Message not found.", 404);
    const messages = await db.supportMessage.findMany({ where: { ticketId: id },
      select: { id: true, body: true, authorRole: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return NextResponse.json({ ticket, messages: messages.slice(0, 50).reverse(), nextCursor: messages.length > 50 ? messages[49].id : null },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    const { id } = await params;
    let input: ReturnType<typeof supportInput>;
    try { input = supportInput(await request.json().catch(() => null), true); }
    catch (error) { throw new CustomerError((error as Error).message, 400); }
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${id} AND "customerId" = ${session.uid} FOR UPDATE`;
      const ticket = await tx.supportTicket.findFirst({ where: { id, customerId: session.uid } });
      if (!ticket) throw new CustomerError("Request not found.", 404);
      const user = await tx.user.findUniqueOrThrow({ where: { id: session.uid }, select: { name: true } });
      // A reply must sort after messages already committed, even in the same millisecond.
      const createdAt = new Date(Math.max(Date.now(), ticket.lastCustomerMessageAt.getTime() + 1, (ticket.lastAdminReplyAt?.getTime() ?? 0) + 1));
      const message = await tx.supportMessage.create({ data: { ticketId: id, authorId: session.uid,
        authorName: user.name, authorRole: "CUSTOMER", body: input.message, createdAt } });
      await tx.supportTicket.update({ where: { id }, data: { lastCustomerMessageAt: message.createdAt,
        status: ticket.status === "RESOLVED" ? "OPEN" : ticket.status } });
      return { message, reopened: ticket.status === "RESOLVED" };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return customerErrorResponse(error); }
}
