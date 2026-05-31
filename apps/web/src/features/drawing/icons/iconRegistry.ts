// Icon registry for customizable layers and objects (My Maps inspired)
// This lets the user pick different icons for layers, similar to Google My Maps.

export type IconKey =
  | "mh" | "hh" | "ped" | "pole" | "cabinet" | "anchor"
  | "pin" | "flag" | "warning" | "star" | "circle" | "square"
  | "exclamation" | "question" | "check" | "x" | "custom";

export interface IconDefinition {
  key: IconKey;
  label: string;
  // For now we use emoji + simple shapes. Later we can add proper SVGs.
  emoji: string;
  category: "telecom" | "general" | "alerts";
}

export const AVAILABLE_ICONS: IconDefinition[] = [
  // Telecom (core to the user's work)
  { key: "mh",        label: "Manhole",       emoji: "🔵", category: "telecom" },
  { key: "hh",        label: "Handhole",      emoji: "⚫", category: "telecom" },
  { key: "ped",       label: "Pedestal",      emoji: "🟦", category: "telecom" },
  { key: "pole",      label: "Pole",          emoji: "⬛", category: "telecom" },
  { key: "cabinet",   label: "Cabinet",       emoji: "🟫", category: "telecom" },
  { key: "anchor",    label: "Anchor/Guy",    emoji: "⚓", category: "telecom" },

  // General My Maps style
  { key: "pin",       label: "Location Pin",  emoji: "📍", category: "general" },
  { key: "flag",      label: "Flag",          emoji: "🚩", category: "general" },
  { key: "star",      label: "Star",          emoji: "⭐", category: "general" },
  { key: "circle",    label: "Circle",        emoji: "●",  category: "general" },
  { key: "square",    label: "Square",        emoji: "■",  category: "general" },

  // Alerts / Field observations (very important for user)
  { key: "warning",     label: "Warning / Damage", emoji: "⚠️", category: "alerts" },
  { key: "exclamation", label: "Important",        emoji: "❗", category: "alerts" },
  { key: "question",    label: "Unknown / TBD",    emoji: "❓", category: "alerts" },
  { key: "check",       label: "Completed / OK",   emoji: "✅", category: "alerts" },
  { key: "x",           label: "Problem / Cut",    emoji: "❌", category: "alerts" },
];

export function getIconByKey(key: string | undefined): IconDefinition {
  if (!key) return AVAILABLE_ICONS[0];
  return AVAILABLE_ICONS.find(i => i.key === key) ?? AVAILABLE_ICONS[0];
}

// Helper to get a simple color swatch + emoji for layer UI
export function getLayerIconPreview(layer: { icon?: string; color?: string }) {
  const icon = getIconByKey(layer.icon);
  return {
    emoji: icon.emoji,
    color: layer.color || "#39ff7a",
  };
}
