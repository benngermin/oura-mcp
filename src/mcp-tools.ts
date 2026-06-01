import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "./client.js";
import { formatLocalDate, today } from "./utils.js";
import { VERSION } from "./version.js";
import { COLLECTION_NAMES, getCollectionDef } from "./collections.js";

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const optDate = z.string().optional().describe("YYYY-MM-DD, defaults to today");

// Default sandbox routing from env (LifeOS addition).
const SANDBOX_DEFAULT =
  process.env.OURA_SANDBOX === "1" ||
  process.env.OURA_SANDBOX?.toLowerCase() === "true";

/**
 * Register the 12 Oura tools on a fresh McpServer bound to one client. Shared by
 * both runtimes: the stdio entrypoint (`mcp.ts`) and the multi-tenant HTTP server
 * (`server.ts`, one client per request). No tool takes an owner/user parameter —
 * the client passed in IS the tenant scope.
 */
export function buildOuraMcpServer(client: OuraClient): McpServer {
  const server = new McpServer({ name: "oura", version: VERSION });

  server.registerTool("oura_daily_summary", {
    title: "Daily Summary",
    description: "Get sleep score, readiness score, sleep details, and activity for a date",
    inputSchema: z.object({ date: optDate }),
  }, async ({ date }) => {
    const d = date ?? today();

    const [sleep, readiness, periods, activity] = await Promise.all([
      client.getDailySleep(d),
      client.getDailyReadiness(d),
      client.getSleepPeriods(d),
      client.getDailyActivity(d),
    ]);
    return text({ date: d, sleep, readiness, sleepPeriods: periods, activity });
  });

  server.registerTool("oura_sleep", {
    title: "Sleep Details",
    description: "Get detailed sleep session data (duration, stages, HR, HRV) for a date",
    inputSchema: z.object({ date: optDate }),
  }, async ({ date }) => {
    const d = date ?? today();

    const [daily, periods] = await Promise.all([
      client.getDailySleep(d),
      client.getSleepPeriods(d),
    ]);
    return text({ date: d, daily, periods });
  });

  server.registerTool("oura_readiness", {
    title: "Readiness Score",
    description: "Get readiness score and contributors for a date",
    inputSchema: z.object({ date: optDate }),
  }, async ({ date }) => {
    const d = date ?? today();

    return text(await client.getDailyReadiness(d));
  });

  server.registerTool("oura_activity", {
    title: "Daily Activity",
    description: "Get daily activity data (steps, calories, distance) for a date",
    inputSchema: z.object({ date: optDate }),
  }, async ({ date }) => {
    const d = date ?? today();

    return text(await client.getDailyActivity(d));
  });

  server.registerTool("oura_workouts", {
    title: "Workouts",
    description: "Get auto-detected workouts with HR, calories, duration, and intensity for a date",
    inputSchema: z.object({ date: optDate }),
  }, async ({ date }) => {
    const d = date ?? today();

    return text(await client.getWorkouts(d));
  });

  server.registerTool("oura_heart_rate", {
    title: "Heart Rate",
    description: "Get continuous heart rate data for a time window. Useful for correlating with untracked workouts.",
    inputSchema: z.object({
      start_datetime: z.string().describe("Start datetime in ISO 8601 format (e.g. 2024-01-01T00:00:00+00:00)"),
      end_datetime: z.string().describe("End datetime in ISO 8601 format (e.g. 2024-01-01T23:59:59+00:00)"),
    }),
  }, async ({ start_datetime, end_datetime }) => {

    return text(await client.getHeartRate(start_datetime, end_datetime));
  });

  server.registerTool("oura_stress", {
    title: "Daily Stress",
    description: "Get daily stress and recovery levels for a date",
    inputSchema: z.object({ date: optDate }),
  }, async ({ date }) => {
    const d = date ?? today();

    return text(await client.getDailyStress(d));
  });

  server.registerTool("oura_spo2", {
    title: "Blood Oxygen (SpO2)",
    description: "Get daily blood oxygen (SpO2) percentage for a date",
    inputSchema: z.object({ date: optDate }),
  }, async ({ date }) => {
    const d = date ?? today();

    return text(await client.getDailySpO2(d));
  });

  server.registerTool("oura_sessions", {
    title: "Sessions",
    description: "Get meditation, breathing, and relaxation sessions for a date",
    inputSchema: z.object({ date: optDate }),
  }, async ({ date }) => {
    const d = date ?? today();

    return text(await client.getSessions(d));
  });

  server.registerTool("oura_trends", {
    title: "Multi-day Trends",
    description: "Get sleep and readiness scores for a date range",
    inputSchema: z.object({
      days: z.number().int().min(1).optional().describe("Number of days to look back (default 7)"),
    }),
  }, async ({ days }) => {
    const n = days ?? 7;


    const now = new Date();
    const endDate = formatLocalDate(now);
    const start = new Date(now);
    start.setDate(start.getDate() - (n - 1));
    const startDate = formatLocalDate(start);

    const [sleepData, readinessData] = await Promise.all([
      client.getDailySleepRange(startDate, endDate),
      client.getDailyReadinessRange(startDate, endDate),
    ]);

    const sleepByDay = new Map(sleepData.map(s => [s.day, s]));
    const readinessByDay = new Map(readinessData.map(r => [r.day, r]));

    const results: Array<{ date: string; sleep_score: number | null; readiness_score: number | null }> = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const ds = formatLocalDate(d);
      results.push({
        date: ds,
        sleep_score: sleepByDay.get(ds)?.score ?? null,
        readiness_score: readinessByDay.get(ds)?.score ?? null,
      });
    }

    return text(results);
  });

  server.registerTool("oura_query", {
    title: "Query Any Oura Collection",
    description:
      "Generic, auto-paginated access to ALL 19 Oura v2 collections — use this to reach data the curated tools don't cover. " +
      "Date-range collections (daily_activity, daily_sleep, daily_readiness, daily_spo2, daily_stress, " +
      "daily_resilience, daily_cardiovascular_age, vO2_max, sleep, sleep_time, workout, session, " +
      "rest_mode_period, tag, enhanced_tag) take start/end as YYYY-MM-DD (default: today). " +
      "heartrate and ring_battery_level take start/end as ISO-8601 datetimes. personal_info and ring_configuration take no dates. " +
      "Follows pagination tokens to return every row in the range (up to max_records).",
    inputSchema: z.object({
      collection: z.enum(COLLECTION_NAMES).describe("Which Oura collection to fetch"),
      start: z.string().optional().describe("Range start — YYYY-MM-DD (ISO-8601 datetime for heartrate). Date collections default to today."),
      end: z.string().optional().describe("Range end — YYYY-MM-DD (ISO-8601 datetime for heartrate). Date collections default to today."),
      paginate: z.boolean().optional().describe("Follow next_token to return all rows (default true)"),
      max_records: z.number().int().min(1).optional().describe("Safety cap on total rows when paginating (default 10000)"),
      sandbox: z.boolean().optional().describe("Use Oura sandbox/demo data instead of real data"),
      latest: z.boolean().optional().describe("heartrate/ring_battery_level only: return just the single most recent sample (ignores the range)"),
      fields: z.string().optional().describe("Comma-separated field names to include in each record (default: all fields)"),
    }),
  }, async ({ collection, start, end, paginate, max_records, sandbox, latest, fields }) => {
    const def = getCollectionDef(collection);
    const opts: {
      startDate?: string;
      endDate?: string;
      startDatetime?: string;
      endDatetime?: string;
      sandbox?: boolean;
      latest?: boolean;
      fields?: string;
    } = { sandbox: sandbox ?? SANDBOX_DEFAULT, latest, fields };

    if (def.shape === "dateRange") {
      opts.startDate = start ?? today();
      opts.endDate = end ?? today();
    } else if (def.shape === "datetimeRange") {
      if (start) opts.startDatetime = start;
      if (end) opts.endDatetime = end;
    }

    // `latest` returns a single sample, so pagination is meaningless — do one fetch.
    if (paginate === false || latest || def.shape === "singleton") {
      const res = await client.getCollection(collection, opts);
      return text({ collection, count: res.data.length, next_token: res.next_token, records: res.data });
    }

    const { records, truncated, nextToken } = await client.getCollectionAll(
      collection,
      opts,
      { maxRecords: max_records ?? 10_000 }
    );
    return text({ collection, count: records.length, truncated, next_token: nextToken, records });
  });

  server.registerTool("oura_personal_info", {
    title: "Personal Info",
    description: "Get account-level personal info (age, weight, height, biological sex, email)",
    inputSchema: z.object({}),
  }, async () => {
    const res = await client.getCollection("personal_info", { sandbox: SANDBOX_DEFAULT });
    return text(res.data[0] ?? null);
  });

  return server;
}
