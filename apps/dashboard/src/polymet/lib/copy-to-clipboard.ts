import { toast } from "sonner";

export async function copyTextToClipboard(text: string) {
  const value = String(text || "").trim();
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back below — clipboard API often blocked outside secure focus contexts.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export async function copyWithToast(text: string, label: string) {
  const ok = await copyTextToClipboard(text);
  if (ok) {
    toast.success("Copied", { description: label });
    return true;
  }
  toast.error("Could not copy", {
    description: "Select the text manually or check browser clipboard permissions.",
  });
  return false;
}
