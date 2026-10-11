// Fetch-It pickup dates are Philippine wall-clock time, regardless of the
// customer's device or the server timezone. Older clients omit the offset.
const OFFSET_MS = 8 * 60 * 60_000;
export function parsePickupSchedule(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const message = "Choose a valid pickup date and time (Philippine time).";
  if (typeof value !== "string") throw new Error(message);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) throw new Error(message);
  const [, year, month, day, hour, minute, second = "0", , zone] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw new Error(message);
  const date = new Date(zone ? value : `${value}+08:00`);
  if (!Number.isFinite(date.getTime())) throw new Error(message);
  return date;
}
export function pickupScheduleIso(value: unknown): string | undefined {
  return parsePickupSchedule(value)?.toISOString();
}
export function pickupScheduleInput(date: Date): string {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}
export function formatPickupSchedule(value: string | Date): string {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
