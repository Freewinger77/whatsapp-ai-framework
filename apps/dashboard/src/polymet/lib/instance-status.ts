import type { Instance } from "@/polymet/data/dashboard-data";

export function instanceIsLive(status: Instance["status"]) {
  return status === "active";
}

export function instanceStatusLabel(status: Instance["status"]) {
  switch (status) {
    case "active":
      return "Active";
    case "offline":
      return "Disconnected";
    case "connecting":
      return "Connecting";
    case "provisioning":
      return "Provisioning";
    case "quality-warning":
      return "Needs attention";
    default:
      return "Disconnected";
  }
}

export function instanceStatusDotClass(status: Instance["status"]) {
  switch (status) {
    case "active":
      return "bg-emerald-500";
    case "quality-warning":
      return "bg-amber-500";
    case "provisioning":
      return "bg-blue-500";
    case "connecting":
      return "bg-sky-500";
    case "offline":
    default:
      return "bg-zinc-400";
  }
}

export function instancePhoneLabel(instance: Pick<Instance, "status" | "phone">) {
  if (instanceIsLive(instance.status)) {
    return instance.phone || "Linked number syncing...";
  }
  if (instance.status === "connecting" || instance.status === "provisioning") {
    return instance.phone || "Not linked yet";
  }
  return "Disconnected";
}
