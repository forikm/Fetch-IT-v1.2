import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export const PH_PHONE_ERROR = "Enter a valid Philippine phone number, such as +63 917 123 4567.";

// Accept local or international PH input; store one canonical +63 number.
export function normalizePhilippinePhone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Phone number is required.");
  }
  const input = value.trim();
  if (input.length > 32 || !/^[+\d\s()-]+$/.test(input)) {
    throw new Error(PH_PHONE_ERROR);
  }
  const phone = parsePhoneNumberFromString(input, { defaultCountry: "PH", extract: false });
  if (!phone || phone.country !== "PH" || !phone.isValid() || phone.ext) {
    throw new Error(PH_PHONE_ERROR);
  }
  return phone.number;
}
