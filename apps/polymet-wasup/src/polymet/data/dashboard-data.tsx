export const USER = {
  name: "there",
  displayName: "Wasup user",
  email: "",
  avatar: "",
};

export type Stat = { label: string; value: string; sub: string };

export const STATS: Stat[] = [
  { label: "Volume", value: "0", sub: "No conversations yet" },
  { label: "Hours saved", value: "0", sub: "Connect an instance to begin" },
  { label: "Best time to contact", value: "No data", sub: "Based on replies" },
];

export type VolumePoint = { date: string; value: number };

export const VOLUME_SERIES: VolumePoint[] = [];

export type Instance = {
  id: string;
  name: string;
  region: string;
  status: "active" | "connecting" | "provisioning" | "quality-warning" | "offline";
  phone: string;
  webhookUrl: string;
  behaviorProfile: "Bot-native" | "Notification balanced" | "Notification max";
  proxy: string;
  messagesToday: string;
  uptime: string;
  qualityScore: string;
  provisioningState?: string;
  lastError?: string;
};

export const INSTANCES: Instance[] = [];

export type ActivityLogItem = {
  source: string;
  level: "Critical" | "High" | "Low";
  instanceId: string;
  time: string;
  timestamp: string;
};

export const INSTANCE_ACTIVITY_LOG: ActivityLogItem[] = [];

export type LiveFeedItem = {
  direction: "Received" | "Sent";
  phone: string;
  text: string;
  instanceId: string;
  time: string;
  timestamp: string;
};

export const LIVE_FEED: LiveFeedItem[] = [];

export const BEHAVIOR_OPTIONS = [
  "Bot-native",
  "Notification balanced",
  "Notification max",
] as const;

export const REGION_OPTIONS = [
  "Finland",
  "Sweden",
  "UK South",
  "UK West",
  "Germany",
  "France",
] as const;

export type ApiKey = {
  id: string;
  label: string;
  expires: string;
  masked: string;
  publicId: string;
  keyKind: "live" | "test";
  oneTimeSecret?: string;
};

export const API_KEYS: ApiKey[] = [];
