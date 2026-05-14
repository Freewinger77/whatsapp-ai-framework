export const USER = {
  name: "Arslan",
  displayName: "Bashir",
  email: "bashir@tryrapidscreen.com",
  avatar: "https://github.com/polymet-ai.png",
};

export const STATS = [
  { label: "Volume", value: "2,405", sub: "+33% month over month" },
  { label: "Hours saved", value: "933", sub: "+20% month over month" },
  { label: "Best time to contact", value: "Wed, 11:30", sub: "Based on replies" },
];

export const VOLUME_SERIES = [
  { date: "23 Nov", value: 420 },
  { date: "24", value: 480 },
  { date: "25", value: 980 },
  { date: "26", value: 910 },
  { date: "27", value: 1380 },
  { date: "28", value: 1720 },
  { date: "29", value: 1590 },
  { date: "30", value: 2405 },
];

export type Instance = {
  id: string;
  name: string;
  region: string;
  status: "active" | "provisioning" | "quality-warning" | "offline";
  phone: string;
  webhookUrl: string;
  behaviorProfile: "Bot-native" | "Notification balanced" | "Notification max";
  proxy: string;
  messagesToday: string;
  uptime: string;
  qualityScore: string;
};

export const INSTANCES: Instance[] = [
  {
    id: "wasup-1",
    name: "Wasup 1",
    region: "Finland",
    status: "active",
    phone: "+4478392039923",
    webhookUrl: "https://api.tryrapidscreen.com/wasup/inbound",
    behaviorProfile: "Notification balanced",
    proxy: "fi-sticky-residential-01",
    messagesToday: "1,204",
    uptime: "99.98%",
    qualityScore: "Healthy",
  },
  {
    id: "wasup-2",
    name: "Wasup 2",
    region: "Sweden",
    status: "active",
    phone: "+44778392039923",
    webhookUrl: "https://n8n.wasup.ai/webhook/sales",
    behaviorProfile: "Bot-native",
    proxy: "se-sticky-residential-03",
    messagesToday: "842",
    uptime: "99.91%",
    qualityScore: "Healthy",
  },
  {
    id: "wasup-3",
    name: "Wasup 3",
    region: "UK South",
    status: "quality-warning",
    phone: "+447700900321",
    webhookUrl: "https://hooks.wasup.ai/customer-support",
    behaviorProfile: "Notification max",
    proxy: "uk-south-pool-pending",
    messagesToday: "359",
    uptime: "98.42%",
    qualityScore: "Warning",
  },
];

export const INSTANCE_ACTIVITY_LOG = [
  { source: "Server Responded with 500 from webhook delivery after retry window elapsed", level: "Critical", instanceId: "wasup-1", time: "2m ago", timestamp: "2026-05-14T01:58" },
  { source: "Prevent cookies from tracking", level: "Low", instanceId: "wasup-2", time: "8m ago", timestamp: "2026-05-14T01:52" },
  { source: "Webhook Failure Responded with 500 while sending conversation.received payload to downstream automation", level: "Critical", instanceId: "wasup-1", time: "13m ago", timestamp: "2026-05-14T01:47" },
  { source: "Unsecure connection", level: "High", instanceId: "wasup-3", time: "19m ago", timestamp: "2026-05-14T01:41" },
  { source: "Rolling log timeout", level: "Low", instanceId: "wasup-2", time: "31m ago", timestamp: "2026-05-14T01:29" },
  { source: "Lorem Ipsum happened", level: "Low", instanceId: "wasup-3", time: "42m ago", timestamp: "2026-05-14T01:18" },
  { source: "Ta da bu hao", level: "High", instanceId: "wasup-1", time: "1h ago", timestamp: "2026-05-14T01:00" },
  { source: "Operator paused bot while reviewing a sensitive billing question", level: "High", instanceId: "wasup-1", time: "1h 8m ago", timestamp: "2026-05-14T00:52" },
  { source: "Message queue drained after downstream webhook latency recovered", level: "Low", instanceId: "wasup-1", time: "1h 16m ago", timestamp: "2026-05-14T00:44" },
  { source: "Fallback response used because RAG lookup exceeded 4 second target", level: "High", instanceId: "wasup-1", time: "1h 28m ago", timestamp: "2026-05-14T00:32" },
  { source: "Webhook retry scheduled for conversation.status.updated payload", level: "Low", instanceId: "wasup-1", time: "1h 36m ago", timestamp: "2026-05-14T00:24" },
  { source: "Critical guard blocked outbound media send until file checksum matched", level: "Critical", instanceId: "wasup-1", time: "1h 48m ago", timestamp: "2026-05-14T00:12" },
  { source: "Typing indicator skipped because human handoff window was active", level: "Low", instanceId: "wasup-1", time: "2h ago", timestamp: "2026-05-14T00:00" },
  { source: "Proxy health probe reported elevated handshake time for sticky route", level: "High", instanceId: "wasup-1", time: "2h 12m ago", timestamp: "2026-05-13T23:48" },
];

export const LIVE_FEED = [
  {
    direction: "Received",
    phone: "+4478392039923",
    text: "Would you like to take a look at this location...",
    instanceId: "wasup-1",
    time: "Now",
    timestamp: "2026-05-14T02:00",
  },
  {
    direction: "Sent",
    phone: "+4478392039923",
    text: "Would you like to take a look at this location...",
    instanceId: "wasup-1",
    time: "1m ago",
    timestamp: "2026-05-14T01:59",
  },
  {
    direction: "Sent",
    phone: "+4478392039923",
    text: "Would you like to take a look at this location...",
    instanceId: "wasup-2",
    time: "4m ago",
    timestamp: "2026-05-14T01:56",
  },
  {
    direction: "Received",
    phone: "+4478392039923",
    text: "Would you like to take a look at this location...",
    instanceId: "wasup-3",
    time: "7m ago",
    timestamp: "2026-05-14T01:53",
  },
  {
    direction: "Sent",
    phone: "+4478392039923",
    text: "Would you like to take a look at this location...",
    instanceId: "wasup-2",
    time: "9m ago",
    timestamp: "2026-05-14T01:51",
  },
  {
    direction: "Received",
    phone: "+447700900321",
    text: "Can you send the location and salary range please?",
    instanceId: "wasup-3",
    time: "14m ago",
    timestamp: "2026-05-14T01:46",
  },
  {
    direction: "Sent",
    phone: "+44778392039923",
    text: "Sure, I have sent the details and next step link.",
    instanceId: "wasup-2",
    time: "18m ago",
    timestamp: "2026-05-14T01:42",
  },
  {
    direction: "Received",
    phone: "+4478392039923",
    text: "Can someone explain the onboarding steps before I book?",
    instanceId: "wasup-1",
    time: "21m ago",
    timestamp: "2026-05-14T01:39",
  },
  {
    direction: "Sent",
    phone: "+4478392039923",
    text: "Absolutely, I can walk you through the steps and tag a teammate if needed.",
    instanceId: "wasup-1",
    time: "22m ago",
    timestamp: "2026-05-14T01:38",
  },
  {
    direction: "Received",
    phone: "+4478392039923",
    text: "Please tag the account manager on this chat.",
    instanceId: "wasup-1",
    time: "27m ago",
    timestamp: "2026-05-14T01:33",
  },
  {
    direction: "Sent",
    phone: "+4478392039923",
    text: "I have paused automation and notified the handoff numbers.",
    instanceId: "wasup-1",
    time: "28m ago",
    timestamp: "2026-05-14T01:32",
  },
  {
    direction: "Received",
    phone: "+4478392039923",
    text: "Thanks, I will wait here for the human reply.",
    instanceId: "wasup-1",
    time: "34m ago",
    timestamp: "2026-05-14T01:26",
  },
];

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
};

export const API_KEYS: ApiKey[] = [
  {
    id: "prod",
    label: "Production Key",
    expires: "Never expires",
    masked: "dev-wa-xf4****-*******-*****",
  },
  {
    id: "dev",
    label: "Dev Key",
    expires: "Expires 20th July (67d)",
    masked: "dev-wa-xf4****-*******-*****",
  },
];
