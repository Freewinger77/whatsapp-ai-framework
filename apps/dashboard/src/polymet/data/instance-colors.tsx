export const INSTANCE_COLORS: Record<string, string> = {
  "wasup-1": "#9ab6c8",
  "wasup-2": "#9bbba6",
  "wasup-3": "#c8a28d",
};

export const INSTANCE_GRADIENTS: Record<string, string> = {
  "wasup-1": "var(--instance-gradient-wasup-1)",
  "wasup-2": "var(--instance-gradient-wasup-2)",
  "wasup-3": "var(--instance-gradient-wasup-3)",
};

const INSTANCE_FALLBACK_GRADIENT = "var(--instance-gradient-fallback)";

export const DICE_GRADIENT_PRESETS = [
  { id: "fjord", label: "Fjord", gradient: INSTANCE_GRADIENTS["wasup-1"] },
  { id: "sage", label: "Sage", gradient: INSTANCE_GRADIENTS["wasup-2"] },
  { id: "clay", label: "Clay", gradient: INSTANCE_GRADIENTS["wasup-3"] },
  {
    id: "slate",
    label: "Slate",
    gradient: "var(--instance-gradient-slate)",
  },
  {
    id: "moss",
    label: "Moss",
    gradient: "var(--instance-gradient-moss)",
  },
];

export function instanceGradient(id: string) {
  return INSTANCE_GRADIENTS[id] ?? INSTANCE_FALLBACK_GRADIENT;
}
