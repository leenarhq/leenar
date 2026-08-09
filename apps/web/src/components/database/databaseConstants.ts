// Shared constants for the database components (TableEditor, tableEditControls,
// tableDetail). Column names that are always auto-managed and cannot be
// authored/edited by the user.
export const RESERVED_COLS = new Set(["id", "created_at"]);
