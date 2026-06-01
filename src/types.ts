/** Oura API v2 response types */

export interface OuraDailySleep {
  day: string;
  score: number | null;
  contributors: {
    deep_sleep: number | null;
    efficiency: number | null;
    latency: number | null;
    rem_sleep: number | null;
    restfulness: number | null;
    timing: number | null;
    total_sleep: number | null;
  };
  timestamp: string;
}

export interface OuraDailyReadiness {
  day: string;
  score: number | null;
  contributors: {
    activity_balance: number | null;
    body_temperature: number | null;
    hrv_balance: number | null;
    previous_day_activity: number | null;
    previous_night: number | null;
    recovery_index: number | null;
    resting_heart_rate: number | null;
    sleep_balance: number | null;
    sleep_regularity: number | null;
  };
  timestamp: string;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
}

export interface OuraSleepPeriod {
  day: string;
  type: "deleted" | "sleep" | "long_sleep" | "late_nap" | "rest" | null;
  bedtime_start: string;
  bedtime_end: string;
  deep_sleep_duration: number;
  light_sleep_duration: number;
  rem_sleep_duration: number;
  average_heart_rate: number | null;
  average_hrv: number | null;
  lowest_heart_rate: number | null;
  efficiency: number | null;
  latency: number | null;
  awake_time: number | null;
}

export interface OuraDailyActivity {
  day: string;
  score: number | null;
  active_calories: number;
  steps: number;
  equivalent_walking_distance: number;
  total_calories: number;
  timestamp: string;
}

export interface OuraApiResponse<T> {
  data: T[];
  next_token?: string;
}

export interface OuraWorkout {
  id: string;
  day: string;
  activity: string;
  calories: number | null;
  distance: number | null;
  end_datetime: string;
  intensity: "easy" | "moderate" | "hard";
  label: string | null;
  source: "manual" | "autodetected" | "confirmed" | "workout_heart_rate";
  start_datetime: string;
}

export interface OuraHeartRate {
  bpm: number;
  source: "awake" | "workout" | "rest" | "sleep" | "live" | "session";
  timestamp: string;
}

export interface OuraDailyStress {
  day: string;
  stress_high: number | null;
  recovery_high: number | null;
  day_summary: "restored" | "normal" | "stressful" | string | null;
}

export interface OuraDailySpO2 {
  day: string;
  spo2_percentage: {
    average: number | null;
  };
}

export interface OuraSession {
  day: string;
  start_datetime: string;
  end_datetime: string;
  type: "breathing" | "meditation" | "nap" | "relaxation" | "rest" | "body_status" | string;
  heart_rate: {
    interval: number;
    items: number[];
    timestamp: string;
  } | null;
  heart_rate_variability: {
    interval: number;
    items: number[];
    timestamp: string;
  } | null;
  motion_count: {
    interval: number;
    items: number[];
    timestamp: string;
  } | null;
  mood: "bad" | "worse" | "same" | "good" | "great" | string | null;
}

export interface OuraTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}
