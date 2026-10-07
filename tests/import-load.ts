// Local disposable Postgres engine only: no contacts are sent to any provider.
process.env.CRM_LOAD_ROWS = "50000";
await import("./database.ts");
export {};
