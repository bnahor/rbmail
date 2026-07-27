export function calendarError(error: unknown) {
  const candidate = error as Error & { status?: number; code?: string };
  const status =
    candidate.status === 401
      ? 401
      : candidate.status === 404
        ? 404
        : candidate.status === 409
          ? 409
          : 502;
  return Response.json(
    {
      error: candidate.message || "Calendar request failed.",
      code:
        candidate.code ||
        (status === 401
          ? "reauth_required"
          : status === 409
            ? "conflict"
            : "provider_error"),
    },
    { status },
  );
}

export function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
