// Open-core stub for apps/web/src/lib/ycAlias.ts.
// The cloud build aliases a demo username to a backing account; open-core has
// no such alias, so this is a pure passthrough with no special-cased values.
export const LOGIN_ACCEPTS_USERNAME = false;

export function resolveLoginEmail(input: string): string {
  return input;
}
