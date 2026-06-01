import type {
  OuraApiResponse,
  OuraDailyActivity,
  OuraDailyReadiness,
  OuraDailySleep,
  OuraDailySpO2,
  OuraDailyStress,
  OuraHeartRate,
  OuraSession,
  OuraSleepPeriod,
  OuraTokens,
  OuraWorkout,
} from "./types.js";
import { loadConfig, saveConfig } from "./config.js";
import { getCollectionDef, type OuraCollectionName } from "./collections.js";

export class OuraClient {
  private accessToken: string;
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;
  private baseUrl = "https://api.ouraring.com";
  // OAuth token endpoint moved to Oura's Curity IdP; the legacy
  // api.ouraring.com/oauth/token no longer works for new-portal apps.
  private tokenUrl = "https://moi.ouraring.com/oauth/v2/ext/oauth-token";
  private refreshPromise: Promise<void> | null = null;
  // Optional persistence hook for rotated tokens. When supplied (e.g. by the
  // multi-tenant HTTP server, which writes back to its per-owner token store),
  // it replaces the default config.json writeback in doRefresh(). When omitted
  // (the stdio/CLI path via fromEnv), doRefresh falls back to ~/.oura-mcp/config.json.
  private onTokensRefreshed?: (t: { accessToken: string; refreshToken: string }) => void;

  constructor(opts: {
    accessToken: string;
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    onTokensRefreshed?: (t: { accessToken: string; refreshToken: string }) => void;
  }) {
    this.accessToken = opts.accessToken;
    this.refreshToken = opts.refreshToken;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.onTokensRefreshed = opts.onTokensRefreshed;
  }

  /** Create client from environment variables, falling back to ~/.oura-mcp/config.json. */
  static fromEnv(): OuraClient {
    const config = loadConfig();

    // Environment OAuth vars take highest priority (explicit override)
    const envAccessToken = process.env.OURA_ACCESS_TOKEN;
    const envRefreshToken = process.env.OURA_REFRESH_TOKEN;
    if (envAccessToken && envRefreshToken) {
      const clientId = process.env.OURA_CLIENT_ID ?? config.clientId;
      const clientSecret = process.env.OURA_CLIENT_SECRET ?? config.clientSecret;
      if (!clientId || !clientSecret) {
        throw new Error("Missing OURA_CLIENT_ID or OURA_CLIENT_SECRET in environment.");
      }
      return new OuraClient({ accessToken: envAccessToken, refreshToken: envRefreshToken, clientId, clientSecret });
    }

    // Stored OAuth tokens written by `oura auth` (config.json)
    if (config.accessToken && config.refreshToken) {
      if (!config.clientId || !config.clientSecret) {
        throw new Error("Stored OAuth tokens are missing clientId/clientSecret. Re-run: oura auth");
      }
      return new OuraClient({
        accessToken: config.accessToken,
        refreshToken: config.refreshToken,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });
    }

    // Personal access token: env, then config file (legacy — Oura has deprecated PATs)
    const pat = process.env.OURA_TOKEN ?? config.token;
    if (pat) {
      return new OuraClient({ accessToken: pat, refreshToken: "", clientId: "", clientSecret: "" });
    }

    throw new Error(
      "No Oura credentials found. Run `oura auth` to authorize via OAuth2 " +
      "(needs OURA_CLIENT_ID + OURA_CLIENT_SECRET from an app at https://developer.ouraring.com).\n" +
      "Tokens are saved to ~/.oura-mcp/config.json. Env overrides: OURA_ACCESS_TOKEN/OURA_REFRESH_TOKEN."
    );
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    let res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 401 && this.refreshToken) {
      await this.serializedRefresh();
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(30_000),
      });
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Oura API ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  private serializedRefresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Token refresh failed: ${body}`);
    }

    const tokens: OuraTokens = await res.json();
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;

    // Persist rotated tokens so the next start (and the next refresh) keeps
    // working across token rotation. An injected persistence hook (HTTP server
    // → per-owner token store) takes precedence; otherwise fall back to the
    // config.json writeback used by the stdio/CLI path.
    if (this.onTokensRefreshed) {
      this.onTokensRefreshed({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });
    } else {
      const cfg = loadConfig();
      if (cfg.accessToken || cfg.refreshToken) {
        cfg.accessToken = tokens.access_token;
        cfg.refreshToken = tokens.refresh_token;
        saveConfig(cfg);
      }
    }
    console.error("[oura] Token refreshed successfully.");
  }

  async getDailySleep(date: string): Promise<OuraDailySleep | null> {
    const res = await this.request<OuraApiResponse<OuraDailySleep>>(
      "v2/usercollection/daily_sleep",
      { start_date: date, end_date: date }
    );
    return res.data[0] ?? null;
  }

  async getDailySleepRange(startDate: string, endDate: string): Promise<OuraDailySleep[]> {
    const res = await this.request<OuraApiResponse<OuraDailySleep>>(
      "v2/usercollection/daily_sleep",
      { start_date: startDate, end_date: endDate }
    );
    return res.data;
  }

  async getDailyReadiness(date: string): Promise<OuraDailyReadiness | null> {
    const res = await this.request<OuraApiResponse<OuraDailyReadiness>>(
      "v2/usercollection/daily_readiness",
      { start_date: date, end_date: date }
    );
    return res.data[0] ?? null;
  }

  async getDailyReadinessRange(startDate: string, endDate: string): Promise<OuraDailyReadiness[]> {
    const res = await this.request<OuraApiResponse<OuraDailyReadiness>>(
      "v2/usercollection/daily_readiness",
      { start_date: startDate, end_date: endDate }
    );
    return res.data;
  }

  async getSleepPeriods(date: string): Promise<OuraSleepPeriod[]> {
    const res = await this.request<OuraApiResponse<OuraSleepPeriod>>(
      "v2/usercollection/sleep",
      { start_date: date, end_date: date }
    );
    return res.data;
  }

  async getDailyActivity(date: string): Promise<OuraDailyActivity | null> {
    const res = await this.request<OuraApiResponse<OuraDailyActivity>>(
      "v2/usercollection/daily_activity",
      { start_date: date, end_date: date }
    );
    return res.data[0] ?? null;
  }

  async getWorkouts(date: string): Promise<OuraWorkout[]> {
    const res = await this.request<OuraApiResponse<OuraWorkout>>(
      "v2/usercollection/workout",
      { start_date: date, end_date: date }
    );
    return res.data;
  }

  async getHeartRate(startDatetime: string, endDatetime: string): Promise<OuraHeartRate[]> {
    const res = await this.request<OuraApiResponse<OuraHeartRate>>(
      "v2/usercollection/heartrate",
      { start_datetime: startDatetime, end_datetime: endDatetime }
    );
    return res.data;
  }

  async getDailyStress(date: string): Promise<OuraDailyStress | null> {
    const res = await this.request<OuraApiResponse<OuraDailyStress>>(
      "v2/usercollection/daily_stress",
      { start_date: date, end_date: date }
    );
    return res.data[0] ?? null;
  }

  async getDailySpO2(date: string): Promise<OuraDailySpO2 | null> {
    const res = await this.request<OuraApiResponse<OuraDailySpO2>>(
      "v2/usercollection/daily_spo2",
      { start_date: date, end_date: date }
    );
    return res.data[0] ?? null;
  }

  async getSessions(date: string): Promise<OuraSession[]> {
    const res = await this.request<OuraApiResponse<OuraSession>>(
      "v2/usercollection/session",
      { start_date: date, end_date: date }
    );
    return res.data;
  }

  // --- Generic collection access (LifeOS addition — see VENDOR.md) ---

  /**
   * Single-page fetch for any Oura v2 usercollection. Params are mapped to the
   * collection's shape (date range / datetime range / singleton / token-only);
   * `sandbox` routes to Oura's demo dataset (same host, `/sandbox/` path).
   *
   * Goes through the audited private `request()`, so auth, 401 token-refresh, and
   * the 30s timeout are inherited unchanged. The `personal_info` singleton returns
   * a bare object upstream; it is normalized into the standard `{data}` envelope.
   */
  async getCollection(
    name: OuraCollectionName,
    opts: {
      startDate?: string;
      endDate?: string;
      startDatetime?: string;
      endDatetime?: string;
      nextToken?: string;
      sandbox?: boolean;
      latest?: boolean;
      fields?: string;
    } = {}
  ): Promise<OuraApiResponse<Record<string, unknown>>> {
    const def = getCollectionDef(name);
    const params: Record<string, string> = {};

    if (def.shape === "dateRange") {
      if (opts.startDate) params.start_date = opts.startDate;
      if (opts.endDate) params.end_date = opts.endDate;
    } else if (def.shape === "datetimeRange") {
      if (opts.startDatetime) params.start_datetime = opts.startDatetime;
      if (opts.endDatetime) params.end_datetime = opts.endDatetime;
      // `latest` (most-recent sample only) is accepted by datetimeRange collections.
      if (opts.latest) params.latest = "true";
    }
    if (def.shape !== "singleton" && opts.nextToken) {
      params.next_token = opts.nextToken;
    }
    if (opts.fields) params.fields = opts.fields;

    const endpoint = `v2/${opts.sandbox ? "sandbox/" : ""}usercollection/${name}`;
    const res = await this.request<unknown>(endpoint, params);

    // personal_info returns a bare object, not the {data,next_token} envelope.
    if (def.shape === "singleton") {
      const obj = res as Record<string, unknown>;
      if (Array.isArray(obj.data)) {
        return res as OuraApiResponse<Record<string, unknown>>;
      }
      return { data: [obj] };
    }
    return res as OuraApiResponse<Record<string, unknown>>;
  }

  /**
   * Auto-paginated fetch — follows `next_token` until exhausted or `maxRecords`
   * is reached, accumulating every row. On hitting the cap with more data still
   * available, returns `{ truncated: true, nextToken }` so the caller can resume.
   * Singletons do a single fetch (no pagination).
   */
  async getCollectionAll(
    name: OuraCollectionName,
    opts: {
      startDate?: string;
      endDate?: string;
      startDatetime?: string;
      endDatetime?: string;
      sandbox?: boolean;
      latest?: boolean;
      fields?: string;
    } = {},
    { maxRecords = 10_000 }: { maxRecords?: number } = {}
  ): Promise<{
    records: Record<string, unknown>[];
    truncated: boolean;
    nextToken?: string;
  }> {
    if (getCollectionDef(name).shape === "singleton") {
      const res = await this.getCollection(name, opts);
      return { records: res.data, truncated: false };
    }

    const records: Record<string, unknown>[] = [];
    let nextToken: string | undefined;

    do {
      const res = await this.getCollection(name, { ...opts, nextToken });
      records.push(...res.data);
      nextToken = res.next_token;

      if (records.length >= maxRecords) {
        return { records, truncated: Boolean(nextToken), nextToken };
      }
    } while (nextToken);

    return { records, truncated: false };
  }
}
