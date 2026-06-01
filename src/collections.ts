/**
 * Single source of truth for every Oura API v2 `usercollection` endpoint.
 *
 * LifeOS addition (not in upstream 3cb0678 — see VENDOR.md). Registering a future
 * Oura endpoint is a one-line change: add an entry here and it becomes queryable
 * through the generic `oura_query` tool with no other code changes.
 */

export type OuraCollectionShape =
  | "dateRange" // start_date / end_date / next_token
  | "datetimeRange" // start_datetime / end_datetime / next_token
  | "singleton" // no params, bare object (no {data,next_token} envelope)
  | "tokenOnly"; // no date range; fields / next_token only

export interface OuraCollectionDef {
  name: string;
  shape: OuraCollectionShape;
}

/** All 19 Oura API v2 `usercollection` collections. */
export const OURA_COLLECTIONS = [
  { name: "daily_activity", shape: "dateRange" },
  { name: "daily_sleep", shape: "dateRange" },
  { name: "daily_readiness", shape: "dateRange" },
  { name: "daily_spo2", shape: "dateRange" },
  { name: "daily_stress", shape: "dateRange" },
  { name: "daily_resilience", shape: "dateRange" },
  { name: "daily_cardiovascular_age", shape: "dateRange" },
  { name: "vO2_max", shape: "dateRange" },
  { name: "sleep", shape: "dateRange" },
  { name: "sleep_time", shape: "dateRange" },
  { name: "workout", shape: "dateRange" },
  { name: "session", shape: "dateRange" },
  { name: "rest_mode_period", shape: "dateRange" },
  { name: "tag", shape: "dateRange" },
  { name: "enhanced_tag", shape: "dateRange" },
  { name: "heartrate", shape: "datetimeRange" },
  { name: "ring_battery_level", shape: "datetimeRange" },
  { name: "personal_info", shape: "singleton" },
  { name: "ring_configuration", shape: "tokenOnly" },
] as const satisfies readonly OuraCollectionDef[];

export type OuraCollectionName = (typeof OURA_COLLECTIONS)[number]["name"];

/** Non-empty string tuple for `z.enum(...)`. */
export const COLLECTION_NAMES = OURA_COLLECTIONS.map((c) => c.name) as [
  OuraCollectionName,
  ...OuraCollectionName[],
];

export function getCollectionDef(name: OuraCollectionName): OuraCollectionDef {
  // `name` is constrained to the known set, so this always resolves.
  return OURA_COLLECTIONS.find((c) => c.name === name)!;
}
