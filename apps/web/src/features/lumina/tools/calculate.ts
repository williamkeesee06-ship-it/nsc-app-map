/**
 * Tool: calculate
 *
 * Safe arithmetic evaluator. Lets Lumina do real math instead of guessing
 * — "5 fieldings × 90 min", "0.4 miles in feet", "if I start at 7am and
 * each stop is 1.5hr, when am I done", etc.
 *
 * Implementation: a strict shunting-yard parser. ONLY accepts:
 *   - numbers (including decimals + scientific notation)
 *   - operators + - * / ^ %
 *   - parentheses
 *   - whitespace
 *
 * No identifiers, no function calls, no Math.*, no `eval`. The regex
 * rejects anything else before evaluation runs, so this is safe to expose
 * to a model that might pass user-influenced strings.
 *
 * Unit conversion is handled as a separate input field rather than parsed
 * out of the expression, so Lumina can ask for "12.4 feet → meters" cleanly.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface CalcInput {
  expression: string;
  /** Optional unit conversion applied to the final scalar. */
  fromUnit?: string;
  toUnit?: string;
}

interface CalcData {
  expression: string;
  /** Raw numeric result of the math. */
  value: number;
  /** When fromUnit/toUnit provided, the converted result. */
  converted?: { value: number; unit: string };
}

// ─────────────────────────────────────────────────────────────────────────
// Strict arithmetic evaluator (shunting-yard)
// ─────────────────────────────────────────────────────────────────────────

const SAFE_RE = /^[\s0-9eE+\-*/^%().]+$/;

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9.eE+\-]/.test(expr[j])) {
        // Stop scientific exponent sign-eating from devouring real operators.
        if ((expr[j] === "+" || expr[j] === "-") && j > i) {
          const prev = expr[j - 1];
          if (prev !== "e" && prev !== "E") break;
        }
        j++;
      }
      tokens.push(expr.slice(i, j));
      i = j;
      continue;
    }
    tokens.push(ch);
    i++;
  }
  return tokens;
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
const RIGHT_ASSOC = new Set(["^"]);

function toRpn(tokens: string[]): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  let prev: string | null = null;
  for (const tok of tokens) {
    if (/^[0-9.]/.test(tok) || /^-?[0-9]/.test(tok)) {
      out.push(tok);
    } else if (tok === "(") {
      stack.push(tok);
    } else if (tok === ")") {
      while (stack.length && stack[stack.length - 1] !== "(") out.push(stack.pop()!);
      if (!stack.length) throw new Error("Mismatched parentheses.");
      stack.pop();
    } else if (PREC[tok] !== undefined) {
      // Unary minus → fold into following number.
      if (tok === "-" && (prev === null || prev === "(" || PREC[prev] !== undefined)) {
        // Look ahead by pushing a 0 so 0-x produces -x.
        out.push("0");
      }
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top === "(" || PREC[top] === undefined) break;
        const pTop = PREC[top];
        const pTok = PREC[tok];
        if (pTop > pTok || (pTop === pTok && !RIGHT_ASSOC.has(tok))) out.push(stack.pop()!);
        else break;
      }
      stack.push(tok);
    } else {
      throw new Error(`Unknown token: ${tok}`);
    }
    prev = tok;
  }
  while (stack.length) {
    const t = stack.pop()!;
    if (t === "(" || t === ")") throw new Error("Mismatched parentheses.");
    out.push(t);
  }
  return out;
}

function evalRpn(rpn: string[]): number {
  const stack: number[] = [];
  for (const tok of rpn) {
    if (PREC[tok] !== undefined) {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error("Bad expression.");
      let r: number;
      switch (tok) {
        case "+": r = a + b; break;
        case "-": r = a - b; break;
        case "*": r = a * b; break;
        case "/": if (b === 0) throw new Error("Divide by zero."); r = a / b; break;
        case "%": r = a % b; break;
        case "^": r = Math.pow(a, b); break;
        default: throw new Error(`Bad op: ${tok}`);
      }
      stack.push(r);
    } else {
      const n = Number(tok);
      if (Number.isNaN(n)) throw new Error(`Not a number: ${tok}`);
      stack.push(n);
    }
  }
  if (stack.length !== 1) throw new Error("Expression did not reduce to a single value.");
  return stack[0];
}

function evaluate(expr: string): number {
  if (!SAFE_RE.test(expr)) {
    throw new Error("Expression contains unsupported characters. Only numbers + - * / ^ % ( ) are allowed.");
  }
  return evalRpn(toRpn(tokenize(expr)));
}

// ─────────────────────────────────────────────────────────────────────────
// Unit conversion — all reduce to a canonical SI base then multiply out.
// Coverage: lengths, time, area, mass — enough for field math.
// ─────────────────────────────────────────────────────────────────────────

const TO_BASE: Record<string, { base: string; factor: number }> = {
  // length → meters
  m: { base: "m", factor: 1 },
  meter: { base: "m", factor: 1 },
  meters: { base: "m", factor: 1 },
  km: { base: "m", factor: 1000 },
  cm: { base: "m", factor: 0.01 },
  mm: { base: "m", factor: 0.001 },
  ft: { base: "m", factor: 0.3048 },
  foot: { base: "m", factor: 0.3048 },
  feet: { base: "m", factor: 0.3048 },
  in: { base: "m", factor: 0.0254 },
  inch: { base: "m", factor: 0.0254 },
  inches: { base: "m", factor: 0.0254 },
  yd: { base: "m", factor: 0.9144 },
  yard: { base: "m", factor: 0.9144 },
  yards: { base: "m", factor: 0.9144 },
  mi: { base: "m", factor: 1609.344 },
  mile: { base: "m", factor: 1609.344 },
  miles: { base: "m", factor: 1609.344 },
  // time → seconds
  s: { base: "s", factor: 1 },
  sec: { base: "s", factor: 1 },
  seconds: { base: "s", factor: 1 },
  min: { base: "s", factor: 60 },
  mins: { base: "s", factor: 60 },
  minute: { base: "s", factor: 60 },
  minutes: { base: "s", factor: 60 },
  h: { base: "s", factor: 3600 },
  hr: { base: "s", factor: 3600 },
  hour: { base: "s", factor: 3600 },
  hours: { base: "s", factor: 3600 },
  d: { base: "s", factor: 86400 },
  day: { base: "s", factor: 86400 },
  days: { base: "s", factor: 86400 },
  // mass → kg
  kg: { base: "kg", factor: 1 },
  g: { base: "kg", factor: 0.001 },
  lb: { base: "kg", factor: 0.45359237 },
  lbs: { base: "kg", factor: 0.45359237 },
  pound: { base: "kg", factor: 0.45359237 },
  pounds: { base: "kg", factor: 0.45359237 },
};

function convert(value: number, from: string, to: string): number {
  const f = TO_BASE[from.toLowerCase()];
  const t = TO_BASE[to.toLowerCase()];
  if (!f) throw new Error(`Unknown from-unit "${from}".`);
  if (!t) throw new Error(`Unknown to-unit "${to}".`);
  if (f.base !== t.base) throw new Error(`Cannot convert ${from} → ${to} (different dimensions).`);
  return (value * f.factor) / t.factor;
}

async function run(
  input: CalcInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<CalcData>> {
  try {
    if (!input.expression || !input.expression.trim()) {
      return { ok: false, message: "calculate requires an expression." };
    }
    const value = evaluate(input.expression);
    const data: CalcData = { expression: input.expression, value };
    if (input.fromUnit && input.toUnit) {
      const converted = convert(value, input.fromUnit, input.toUnit);
      data.converted = { value: converted, unit: input.toUnit };
    }
    const msg = data.converted
      ? `${input.expression} = ${value}; ${data.converted.value} ${data.converted.unit}`
      : `${input.expression} = ${value}`;
    return { ok: true, message: msg, data };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export const calculateTool: LuminaTool<CalcInput, CalcData> = {
  name: "calculate",
  description:
    "Evaluate a math expression (+ - * / ^ % parens). Optionally convert the result between units: m/km/cm/mm/ft/in/yd/mi, s/min/hr/day, kg/g/lb. Use for any numeric work — don't guess arithmetic.",
  kind: "read",
  run,
};
