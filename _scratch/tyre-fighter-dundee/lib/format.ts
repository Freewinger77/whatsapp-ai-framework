export function formatPhone(value: string | null | undefined) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("44") && digits.length >= 12) {
    return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  if (digits.length > 8) return `+${digits}`;
  return value;
}

export function conversationLabel(title: string | null, chatJid: string, kind: string) {
  if (title && !title.startsWith("Group ")) return title;
  const local = chatJid.split("@")[0] || chatJid;
  if (kind === "group") {
    if (local.includes("-")) return `Trade group · ${local.split("-")[0]}`;
    return `Trade group · ${local.slice(-6)}`;
  }
  return formatPhone(local) || local;
}

export function relativeTime(iso: string | null) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = Date.now() - then;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function waitLabel(iso: string | null) {
  if (!iso) return null;
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 15) return `${Math.max(minutes, 1)}m waiting`;
  if (minutes < 60) return `${minutes}m waiting`;
  return `${Math.floor(minutes / 60)}h waiting`;
}
