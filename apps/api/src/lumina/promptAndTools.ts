/**
 * Shared system prompt + tool declarations for Lumina.
 *
 * Both the Live API token issuer (luminaLiveToken.ts) and the text-mode
 * chat proxy (luminaChat.ts) import from here so voice and text behave
 * identically. Changing a tool or a truth lock in one place flips both.
 *
 * The declarations use Live API casing (TYPE: "STRING"). The chat proxy
 * normalizes to lowercase before handing to the Generative AI SDK.
 */

export const LUMINA_SYSTEM_INSTRUCTION = `=====================================================================
  ABSOLUTE TRUTH RULES — VOICE MODE LOCK
=====================================================================
You are Lumina, the AI assistant embedded in Billy Keesee's NSC Map App at
North Sky Communications. You are in LIVE voice mode. Billy hears every
word in real-time. The cost of fabricating a job number, address, date,
or crew name spoken aloud is far higher than the cost of saying "I don't
have that".

1. TOOL-GROUNDED ANSWERS ONLY. You may NOT state any North Sky data
   (work order, address, crew, status, notes, dates, markup labels,
   photo counts) unless a tool call in the CURRENT turn returned it.
   No memory recall of work data. No inference from "what jobs usually
   look like". If you don't have it from a tool, you don't have it.

2. VERBATIM QUOTATION. Quoted strings (work orders, tags, addresses,
   crew names, status values, dates) must be character-for-character
   copies of tool output. No rounding dates ("around mid-April").
   No paraphrasing names. Quote it or omit it.

3. REFUSAL TEMPLATE — when data is missing, say exactly:
       "I don't have that — want me to look it up?"
   For partial misses:
       "I have the job but no [field] on file — want me to pull it up?"
   No improvisation, no apology spirals.

4. WRITE ACTIONS ARE NEVER SILENT. Tools whose name starts with
   "propose" do NOT actually write to Firestore. They queue an action
   that Billy must approve via an on-screen confirmation card. After
   calling a propose* tool, tell Billy: "Queued — check the card on
   screen to approve." Do NOT say the change is done; it isn't yet.

5. MARKUPS ARE ALWAYS VISIBLE. There is no tool to hide or toggle
   markups. Do not offer or imply that ability. If Billy asks to hide
   markups, explain that markups stay visible by design.

=====================================================================
  MAP NAVIGATION (call these freely — they're read-only)
=====================================================================
- flyToAddress(address): geocode + pan + drop neon pin. Use when Billy
  mentions a specific address.
- flyToJob(jobId): pan/zoom to a job. Use when Billy mentions a WO.
- flyToCoords(lat, lng, zoom?): direct coordinate jump.
- flyToMarkup(jobId, objectId): zoom to a specific pole/MH/splice.
- setMapType(type): roadmap / satellite / hybrid / terrain.
- setZoom(level): explicit zoom set.
- dropPin(address_or_coords, label?): temporary marker.
- clearPins(): remove all Lumina-dropped pins.
- showRoute(fromJobId, toJobId): overlay a route line.
- selectJob(jobId): open the job card.
- filterJobsOnMap(criteria): hide/show jobs by crew/status/age.
- clearFilters(): restore default job view.

=====================================================================
  READ TOOLS (call these for data)
=====================================================================
- listJobs(filter): list jobs filtered by crew, status, age, geography.
- getJob(jobId): full record for one job.
- listMarkups(jobId): drawing objects for a job's markup.
- listPhotos(jobId, objectId?): photo metadata for a job or markup.
- searchAddress(query): geocode an address string.

=====================================================================
  WRITE TOOLS (propose-pattern — produce confirmation cards)
=====================================================================
- proposeNotesUpdate(jobId, notes): draft a notes update.
- proposeStatusChange(jobId, status): draft a status change.
- proposeMarkupLabel(jobId, objectId, label): draft a markup label change.

For every propose* tool: tell Billy verbally that it's queued and ask
him to approve on screen. NEVER say it's done.

=====================================================================
  STYLE
=====================================================================
- Tight. Field-radio cadence. Billy is usually in a truck or on a pole.
- No filler. No "let me check" — just call the tool.
- Use his vocabulary: WO, splice, pole tag, atag, MH, handhole, asbuilt,
  fielding, RTS, QC.
- Crews he knows by name: Heritage, Robbie, Joe.
- Never speculate about credit usage, AI cost, or model behavior.

You're listening. Billy can interrupt at any time.`;


export const LUMINA_TOOLS = [
  {
    functionDeclarations: [
      // ── Map navigation (read-only) ──────────────────────────────────────
      {
        name: "flyToAddress",
        description:
          "Geocode an address, pan/zoom the map to it, and drop a neon pin. Use whenever Billy mentions a specific street address.",
        parameters: {
          type: "OBJECT",
          properties: { address: { type: "STRING" }, label: { type: "STRING" } },
          required: ["address"],
        },
      },
      {
        name: "flyToJob",
        description: "Pan/zoom the map to a job's location. Call when Billy mentions a specific work order.",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING", description: "Firestore job id or work order string." } },
          required: ["jobId"],
        },
      },
      {
        name: "flyToCoords",
        description: "Pan/zoom to a specific lat/lng.",
        parameters: {
          type: "OBJECT",
          properties: {
            lat: { type: "NUMBER" },
            lng: { type: "NUMBER" },
            zoom: { type: "NUMBER" },
          },
          required: ["lat", "lng"],
        },
      },
      {
        name: "flyToMarkup",
        description: "Zoom to a specific markup object (pole, MH, splice, etc.) on a given job.",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING" }, objectId: { type: "STRING" } },
          required: ["jobId", "objectId"],
        },
      },
      {
        name: "setMapType",
        description: "Change the map base layer.",
        parameters: {
          type: "OBJECT",
          properties: {
            mapType: { type: "STRING", enum: ["roadmap", "satellite", "hybrid", "terrain"] },
          },
          required: ["mapType"],
        },
      },
      {
        name: "setZoom",
        description: "Set the map zoom level explicitly.",
        parameters: {
          type: "OBJECT",
          properties: { zoom: { type: "NUMBER" } },
          required: ["zoom"],
        },
      },
      {
        name: "dropPin",
        description: "Drop a temporary Lumina-owned marker (separate from job markups).",
        parameters: {
          type: "OBJECT",
          properties: {
            address: { type: "STRING" },
            lat: { type: "NUMBER" },
            lng: { type: "NUMBER" },
            label: { type: "STRING" },
          },
        },
      },
      {
        name: "clearPins",
        description: "Remove all Lumina-dropped pins from the map.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "showRoute",
        description: "Draw a route line overlay between two jobs.",
        parameters: {
          type: "OBJECT",
          properties: { fromJobId: { type: "STRING" }, toJobId: { type: "STRING" } },
          required: ["fromJobId", "toJobId"],
        },
      },
      {
        name: "selectJob",
        description: "Open the job card overlay for a job (same as clicking the job pin).",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING" } },
          required: ["jobId"],
        },
      },
      {
        name: "filterJobsOnMap",
        description: "Hide/show jobs on the map by crew, status, or age in days.",
        parameters: {
          type: "OBJECT",
          properties: {
            crew: { type: "STRING" },
            status: { type: "STRING" },
            olderThanDays: { type: "NUMBER" },
          },
        },
      },
      {
        name: "clearFilters",
        description: "Restore the default job view (all jobs visible).",
        parameters: { type: "OBJECT", properties: {} },
      },

      // ── Read tools ──────────────────────────────────────────────────────
      {
        name: "listJobs",
        description: "List jobs filtered by crew, status, age in days, or geography.",
        parameters: {
          type: "OBJECT",
          properties: {
            crew: { type: "STRING" },
            status: { type: "STRING" },
            olderThanDays: { type: "NUMBER" },
            city: { type: "STRING" },
          },
        },
      },
      {
        name: "getJob",
        description: "Fetch the full record for one job from Firestore.",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING" } },
          required: ["jobId"],
        },
      },
      {
        name: "listMarkups",
        description: "List drawing objects (poles, MHs, splices, lines, shapes) for a job.",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING" } },
          required: ["jobId"],
        },
      },
      {
        name: "listPhotos",
        description: "List photo metadata for a job, optionally scoped to one markup object.",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING" }, objectId: { type: "STRING" } },
          required: ["jobId"],
        },
      },
      {
        name: "searchAddress",
        description: "Geocode an address and return lat/lng + formatted address. Does not move the map.",
        parameters: {
          type: "OBJECT",
          properties: { query: { type: "STRING" } },
          required: ["query"],
        },
      },

      // ── Write tools — all PROPOSE pattern (gated by confirmation cards) ─
      {
        name: "proposeNotesUpdate",
        description:
          "Draft a notes update for a job. Does NOT write — queues a confirmation card that Billy must approve.",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING" }, notes: { type: "STRING" } },
          required: ["jobId", "notes"],
        },
      },
      {
        name: "proposeStatusChange",
        description:
          "Draft a status change for a job. Does NOT write — queues a confirmation card that Billy must approve.",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING" }, status: { type: "STRING" } },
          required: ["jobId", "status"],
        },
      },
      {
        name: "proposeMarkupLabel",
        description:
          "Draft a label change for a markup object. Does NOT write — queues a confirmation card that Billy must approve.",
        parameters: {
          type: "OBJECT",
          properties: {
            jobId: { type: "STRING" },
            objectId: { type: "STRING" },
            label: { type: "STRING" },
          },
          required: ["jobId", "objectId", "label"],
        },
      },
    ],
  },
];

/** Extract just the inner functionDeclarations[] for SDK-style use. */
export const LUMINA_FUNCTION_DECLARATIONS = LUMINA_TOOLS[0].functionDeclarations;
