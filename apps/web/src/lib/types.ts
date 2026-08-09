export interface LogEntry {
  time: string;
  source: string;
  msg: string;
  type: "info" | "success" | "warning" | "error";
}
