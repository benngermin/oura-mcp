---
name: oura
description: Query Oura Ring health data — sleep, readiness, activity, workouts, HR, stress, SpO2, sessions, and trends
argument-hint: "[sleep | readiness | activity | workouts | stress | spo2 | sessions | trends | hr <start> <end> | summary]"
allowed-tools: mcp__oura__oura_daily_summary, mcp__oura__oura_sleep, mcp__oura__oura_readiness, mcp__oura__oura_activity, mcp__oura__oura_workouts, mcp__oura__oura_heart_rate, mcp__oura__oura_stress, mcp__oura__oura_spo2, mcp__oura__oura_sessions, mcp__oura__oura_trends, mcp__oura__oura_query, mcp__oura__oura_personal_info
---

# /oura — Oura Ring Health Data

Query and present Oura Ring health data in a conversational, insight-driven format.

## First-Time Setup

If any tool call returns an auth error:
1. Tell the user: "Oura isn't connected yet. Create an app at https://developer.ouraring.com (redirect URI `http://localhost:9876/callback`), then run `OURA_CLIENT_ID=... OURA_CLIENT_SECRET=... cd ~/LifeOS/tools/mcps/oura-mcp && npm run dev -- auth` to authorize. (Oura has deprecated personal access tokens — OAuth2 is required.)"
2. Do not retry until the user confirms they've set it up.

## When to Use

Trigger on phrases like:
- "How did I sleep?" / "sleep score" / "sleep data"
- "How's my readiness?" / "am I recovered?"
- "Show my activity" / "steps today"
- "Any workouts?" / "workout data"
- "Heart rate during..." / "HR data"
- "Stress levels" / "how stressed am I?"
- "Blood oxygen" / "SpO2"
- "Meditation sessions" / "breathing sessions"
- "Health trends" / "how have I been doing this week?"
- "Oura summary" / "health briefing"

## Arguments

Parse from `$ARGUMENTS`:

| Argument | Action |
|----------|--------|
| *(empty)* | Daily health briefing for today |
| `sleep` | Detailed sleep data |
| `readiness` | Readiness score and contributors |
| `activity` | Activity data (steps, calories, distance) |
| `workouts` | Auto-detected workouts |
| `hr <start> <end>` | Heart rate for a time window (ISO 8601 datetimes) |
| `stress` | Daily stress and recovery |
| `spo2` | Blood oxygen percentage |
| `sessions` | Meditation, breathing, relaxation sessions |
| `trends` or `trends <days>` | Multi-day sleep + readiness trends (default 7 days) |
| `summary` | Full daily summary (same as empty) |

For anything not covered above — resilience, cardiovascular age, VO₂ max, sleep time, rest-mode periods, tags, ring configuration, ring battery level, or personal info — use `oura_query` with the matching `collection` (and `start`/`end` for ranges; it auto-paginates). Use `oura_personal_info` for account details (age, height, weight, biological sex, email).

### `oura_query` payload size — IMPORTANT

- **`fields` must be a comma-separated STRING, not an array.** `fields: "day,score,steps"` works; `fields: ["day","score"]` is **silently ignored** and the full record is returned. This is the #1 cause of oversized responses.
- **Verbose collections** carry minute-level arrays and will blow past the inline output limit (dumping to a temp file) unless you whitelist `fields` or use a narrow range:
  - `daily_activity` → per-minute `met` + `class_5_min` (≈1,500 lines/day)
  - `sleep` → per-minute `heart_rate` / `hrv` / `movement_30_sec`
  - `heartrate` → one row per ~5-min sample
  Always pass a `fields` whitelist for these. Useful whitelists:
  - `daily_activity`: `day,score,steps,active_calories,total_calories,equivalent_walking_distance,high_activity_time,medium_activity_time,low_activity_time,sedentary_time,resting_time,non_wear_time`
  - `sleep`: `day,type,total_sleep_duration,time_in_bed,efficiency,average_heart_rate,lowest_heart_rate,average_hrv,deep_sleep_duration,rem_sleep_duration,light_sleep_duration,awake_time,latency,restless_periods,bedtime_start,bedtime_end,average_breath`
- If a response still overflows and is saved to a temp file, **don't read it into the main context** — dispatch a subagent to read it in ~250-line chunks and return only the extracted per-day rows.

Dates default to today. If the user mentions a specific date (e.g., "yesterday", "last Tuesday"), convert it to YYYY-MM-DD format.

## Workflows

### Review all data / full health review

When the user asks to "review everything," "all my data," or wants a comprehensive multi-collection analysis:

1. **First find the data window.** Query a summary collection (e.g. `daily_sleep` with `fields: "day,score"`) over a wide range to find the earliest record — Oura only returns data from when the ring started recording, not an API floor.
2. **Pull summary collections inline** with `fields` whitelists: `daily_sleep`, `daily_readiness`, `daily_activity`, `daily_stress`, `daily_spo2`, `daily_resilience`, `daily_cardiovascular_age`, `vO2_max`, `workout`, `session`. These stay small enough to read directly when whitelisted.
3. **Route verbose collections through a subagent.** For `sleep` (and `heartrate` if needed), either whitelist `fields` aggressively or, if the payload still overflows to a temp file, dispatch a subagent to extract per-day rows so the raw minute-level data never enters the main context.
4. **Synthesize, don't dump.** Lead with avg sleep/readiness/activity, flag concerns (low efficiency, low HRV/high RHR nights, acute outliers, stress load, sedentary trends), call out positives, and note data-quality caveats (short baseline window, nap/rest noise records, non-wear gaps).

### Default / Summary (no args or `summary`)

1. Call `oura_daily_summary` (no args — defaults to today)
2. Present as a health briefing:
   - Lead with sleep score and readiness score as headline numbers
   - Highlight anything notable (low scores, high HRV, unusual patterns)
   - Include key activity metrics (steps, calories)
   - Keep it conversational — 3-5 sentences max for the overview
3. Offer: "Want me to dig into sleep details, trends, or anything specific?"

### Sleep (`sleep`)

1. Call `oura_sleep`
2. Present insights:
   - Sleep score and total sleep time
   - Sleep stage breakdown (deep, REM, light, awake)
   - Average HR and HRV during sleep
   - Notable patterns (e.g., high awake time, low deep sleep)
3. Compare to typical ranges if data suggests anything unusual

### Readiness (`readiness`)

1. Call `oura_readiness`
2. Present:
   - Readiness score as headline
   - Top contributing factors (positive and negative)
   - Actionable insight (e.g., "Recovery looks good — solid day for a hard workout" or "Below baseline — consider taking it easy")

### Activity (`activity`)

1. Call `oura_activity`
2. Present:
   - Steps, active calories, total calories
   - Activity score if available
   - Distance, movement metrics

### Workouts (`workouts`)

1. Call `oura_workouts`
2. Present each workout:
   - Type, duration, calories burned
   - Intensity level
   - (Optional) Correlate HR by calling `oura_heart_rate` over the workout's start/end datetimes — workout records themselves carry no HR
3. If no workouts found, say so and suggest checking the date

### Heart Rate (`hr <start> <end>`)

1. Parse start and end datetimes from arguments
2. Call `oura_heart_rate` with `start_datetime` and `end_datetime`
3. Present:
   - HR range (min, max, average) over the window
   - Notable spikes or drops
   - If the window overlaps a workout, note the correlation
4. If args are missing, ask: "I need a time window — e.g., `/oura hr 2026-03-11T08:00:00+00:00 2026-03-11T09:00:00+00:00`"

### Stress (`stress`)

1. Call `oura_stress`
2. Present:
   - Stress level and recovery balance
   - Context on what the numbers mean

### SpO2 (`spo2`)

1. Call `oura_spo2`
2. Present:
   - SpO2 percentage
   - Note if it's in normal range (95-100%) or worth attention

### Sessions (`sessions`)

1. Call `oura_sessions`
2. Present each session:
   - Type (meditation, breathing, etc.), duration
   - HR data if available
3. If no sessions, say "No sessions recorded today."

### Trends (`trends` or `trends <days>`)

1. Parse optional days count from arguments (default 7)
2. Call `oura_trends` with `days` parameter
3. Present:
   - Sleep and readiness scores over the period
   - Use a simple text table or aligned format for readability
   - Highlight best/worst days
   - Note any patterns (improving, declining, consistent)
   - Calculate averages

## Presentation Style

- **Lead with numbers**: "Sleep: 85 | Readiness: 78" — scores first, details after
- **Conversational tone**: Brief insights, not raw JSON dumps
- **Highlight anomalies**: Flag anything notably high, low, or different from recent patterns
- **Offer next steps**: End with a suggestion for what else to explore
- **Keep it concise**: Default to a brief overview; go deeper only when asked or when the specific endpoint is requested
- **Dates**: Show dates in a human-friendly format (e.g., "Monday Mar 10") alongside scores
