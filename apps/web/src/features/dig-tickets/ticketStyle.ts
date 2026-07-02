import type { DigTicketStatus, UtilityStatus } from "@nsc/types";

// Status → chip color. Neon-orange family for the 811 feature, with red/green
// accents for terminal states.
export function statusColor(status: DigTicketStatus): string {
  switch (status) {
    case "Drafting":
      return "#6e757f";
    case "Filing":
      return "#ff9a4d";
    case "Review":
      return "#ff6a00";
    case "Filed":
      return "#0891b2";
    case "Active":
      return "#16a34a";
    case "Expiring":
      return "#f59e0b";
    case "Expired":
      return "#dc2626";
    case "Failed":
      return "#b91c1c";
    default:
      return "#6e757f";
  }
}

export function utilityStatusColor(status: UtilityStatus["status"]): string {
  switch (status) {
    case "pending":
      return "#6e757f";
    case "in-progress":
      return "#ff9a4d";
    case "marked":
      return "#16a34a";
    case "clear":
      return "#0891b2";
    case "conflict":
      return "#dc2626";
    default:
      return "#6e757f";
  }
}

export const UTILITY_STATUS_OPTIONS: UtilityStatus["status"][] = [
  "pending",
  "in-progress",
  "marked",
  "clear",
  "conflict",
];
