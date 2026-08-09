// Edge maintenance is a Leenar Cloud operational feature — core ships no
// maintenance page. This no-op keeps the shared web edge worker importable.
export function maintenanceResponse(
  _request?: Request,
  _env?: unknown,
): Response | null {
  return null;
}
