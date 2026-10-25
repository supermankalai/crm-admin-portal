import { ApiError, NetworkError } from "@fitcrm/shared/api/client";

/** A message for the user. Server messages are already written for people; never show stack traces. */
export function errorMessage(error: unknown): string {
  if (error instanceof NetworkError) return "You're offline or the server can't be reached. Check your connection and try again.";
  if (error instanceof ApiError) return error.status >= 500 ? "Something went wrong on our side. Please try again." : error.message;
  return "Something went wrong. Please try again.";
}

export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.fieldErrors) return {};
  return Object.fromEntries(Object.entries(error.fieldErrors).map(([k, v]) => [k, v[0] ?? ""]));
}
