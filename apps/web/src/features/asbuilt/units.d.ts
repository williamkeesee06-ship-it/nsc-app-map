// Type shim for units.js — see /home/user/workspace/asbuilt-source/js/units.js
// Only the subset we call from native React.

export const ASBUILT_THEME: {
  NEW: string;
  EXISTING: string;
  REMOVE: string;
  XFER: string;
  DE_RELASH: string;
  TRENCH: string;
  BORE: string;
};

export interface ResolvedUnit {
  unit_code: string | null;
  desc: string;
  unit: string;
  qty: number;
  color: string;
  label?: string | null;
  removeXMarks?: boolean;
  calloutText?: string | null;
  calloutLines?: string[] | null;
  dashArray?: string | null;
  billDashCode?: string | null;
  billDashHours?: number | null;
  trenchDetail?: unknown;
  extraUnits: Array<{
    unit_code: string;
    desc: string;
    unit: string;
    qty: number;
  }>;
}

export function resolveSmartUnit(
  category: string,
  symbolKey: string,
  attributes?: Record<string, unknown>
): ResolvedUnit | null;

export function resolveUnit(
  symbolKey: string,
  attributes?: Record<string, unknown>
): ResolvedUnit | null;
