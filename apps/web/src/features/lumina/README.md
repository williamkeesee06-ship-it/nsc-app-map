# Lumina — map-app integration

This folder is scoped: Tailwind utility classes (prefixed `lx-`) only exist
inside this directory. The rest of the map app remains on plain CSS + the
brushed-steel theme (`src/styles/theme.css`).

## Locked rules

1. **Tool-grounded answers only.** Any statement about North Sky data must
   come from a tool call result in the current turn. No invention.
2. **Verbatim quotation.** Quoted strings are character-for-character.
3. **Refusal template.** Missing data ⇒ "I don't have that — want me to
   look it up?" — no improvisation.
4. **Writes are never silent.** Every write proposes an action and waits
   for a confirmation card click before the real API runs.
5. **MARKUPS ARE ALWAYS VISIBLE.** No tool may hide/toggle markups.

## Folder layout

```
features/lumina/
  voice/        Gemini Live client, mic capture, TTS — ported as-is
  tools/        Tool registry. Read tools and "propose*" write tools.
  messages/     Chat message rendering + tool-call trace strip
  store/        Zustand store for Lumina-local state
  prompts/      System prompts (chat + live). Versioned in code.
  lumina.css    Tailwind entry. Only consumed by files in this folder.
```

## Visual identity

- Electric blue **`#1ea7ff`** is Lumina's primary in the map app.
- "What Lumina touches glows neon blue" — three flavors:
  - **Nav glow** (Option C): ring sweeps from orb to target, then target
    pulses briefly.
  - **Write glow**: markup pulses neon for ~2s after Apply.
  - **Working glow**: tab rim animates while tools are firing.
