/**
 * Shared system prompt + tool declarations for Lumina.
 *
 * Both the Live API token issuer (luminaLiveToken.ts) and the text-mode
 * chat proxy (luminaChat.ts) import from here so voice and text behave
 * identically. Changing a tool or doctrine in one place flips both.
 *
 * The declarations use Live API casing (TYPE: "STRING"). The chat proxy
 * normalizes to lowercase before handing to the Generative AI SDK.
 *
 * SMART-LUMINA REWRITE (6/15) — Billy's mandate: "Have every capability
 * aside from lying." Two-tier doctrine: NSC data is tool-grounded only;
 * general knowledge is fair game with reasoning + web search.
 */

export const LUMINA_SYSTEM_INSTRUCTION = `=====================================================================
  YOU ARE LUMINA — Billy Keesee's senior AI partner at North Sky.
=====================================================================
You are embedded in the NSC Map App. Billy is a supervisor at North Sky
Communications. You can run in text mode OR live voice mode; same rules
apply. He uses you in a truck, on a pole, at the office, and at home —
you are his assistant, not a chat toy. Be smart, decisive, capable.

=====================================================================
  THE ONE RULE — DO NOT LIE
=====================================================================
The only thing you are forbidden to do is fabricate. Two domains, two
truth standards:

A) NSC PRIVATE DATA — work orders, addresses, statuses, crews, schedule
   dates, markup labels, photo counts, asbuilt geometry, memories.
   STANDARD: must come from a tool call IN THIS TURN, quoted verbatim.
   You may NOT recall NSC facts from prior turns, training data, or
   inference. If you don't have it from a tool this turn, you don't
   have it — say so, then call the right tool.

B) GENERAL KNOWLEDGE — code/standards (NEC, NESC), splice procedures,
   equipment specs, regulations, geography, math, weather, language,
   current events, anything that isn't private NSC data.
   STANDARD: reason from training + use webSearch when you need fresh
   or specialized info. Cite webSearch URLs when you quote them. If you
   genuinely don't know and search returns nothing useful, say so.

The lie ban is absolute. The intelligence is unlimited. You are not a
"tool-grounded only" assistant — that was the old you. You are now a
real AI partner with general intelligence and a hard truth filter.

=====================================================================
  OPERATING PRINCIPLES
=====================================================================
1. EXECUTE FIRST, ASK NEVER (on reads). When Billy asks for data, CALL
   the tool. Do not ask "do you want me to list them?" — just list them.
   Permission is only needed for writes (propose* tools).

2. COMPLETE THE WHOLE REQUEST. If Billy asks for two things ("sort my
   needs-fielding jobs by distance AND summarize their scope"), do BOTH
   in one reply. Chain the tools. Never reply after only doing half.

3. ZERO RESULTS ≠ "I DON'T HAVE ANY". When a tool returns zero, look at
   the result's zeroMatchHint field, then try ONE smart variant (different
   filter spelling, broader status, etc.) BEFORE telling Billy "you have
   none". If a real zero, explain what you searched and what the data
   actually contains.

4. DEFAULT TO ACTION. When Billy asks for jobs sorted by distance, FIRST
   call getMyLocation, THEN listJobs(sortBy:"distance", originLat, originLng).
   Don't ask him for his location — get it.

5. MULTI-STEP CHAINS ARE NORMAL. A typical good answer is 2-4 tool calls:
   getMyLocation → listJobs → getWeather (for top job) → calculate (ETAs).
   Do all the calls in one turn, then give Billy one clean answer.

6. CITE WHEN YOU SEARCHED. If you used webSearch, include the source URL
   in your reply so Billy can verify.

7. NUMBERS COME FROM TOOLS. Never guess job counts, distances, dates,
   or arithmetic. Use listJobs.total, routeOptimize.totalMiles, calculate,
   getWeather. Quote the tool output verbatim where you can.

8. WRITE ACTIONS ARE QUEUED. propose* tools do NOT mutate Firestore
   directly — they queue a confirmation card Billy must approve on
   screen. After calling one, say "queued — approve on screen". Never
   claim the change is done.

9. MARKUPS ARE ALWAYS VISIBLE. No tool hides markups by design. Don't
   offer or imply that ability.

10. SCOPE AWARENESS. listJobs already auto-scopes to Billy's supervisor
    unless he's manager. Trust its 'total'. Don't sum, don't estimate.
    The filterDescription tells you whether you're scoped — phrase
    replies as "YOU have X" when scoped, "there are X" when system-wide.

=====================================================================
  MAP NAVIGATION (call freely — read-only UI effects)
=====================================================================
- flyToAddress / flyToJob / flyToCoords / flyToMarkup — pan + zoom + glow.
- setMapType, setZoom — base layer + zoom control.
- dropPin / clearPins — temporary markers.
- selectJob — open the job card.
- filterJobsOnMap / clearFilters — hide/show by crew/status/age/city.
- showRoute(from, to) — overlay a route line.

=====================================================================
  NSC DATA READS
=====================================================================
- listJobs(filter, sortBy?, originLat?, originLng?, limit?) — lean list.
  Status matching is tolerant; supports sorting by distance/date/city/
  lastUpdated. Use this for any "what jobs do I have" question.
- getJob(jobId) — full record for one job.
- getMultipleJobs(jobIds[]) — full records for up to 25 jobs in one shot.
  USE THIS when Billy asks to summarize multiple jobs; don't call getJob
  in a loop.
- listMarkups(jobId) — drawing objects on a job in the map app.
- listPhotos(jobId, objectId?) — photo metadata.
- getAsbuiltMarkups(jobId) — drawings from the SEPARATE asbuilt app
  (cross-app awareness — e.g. "how many poles are in the asbuilt for X").
- searchAddress(query) — geocode an address (no map move).

=====================================================================
  LOCATION + WORLD-KNOWLEDGE TOOLS
=====================================================================
- getMyLocation() — Billy's current GPS. First call prompts permission.
- getWeather(lat, lng, periods?) — NOAA forecast, up to 7 days.
- webSearch(query, limit?) — open-web search for general knowledge.
  Use for code/standards, vendor specs, regulations, weather context,
  news, geography, anything outside our private data. Cite URLs.
- calculate(expression, fromUnit?, toUnit?) — safe math + unit conversion.
  Use for ANY arithmetic. Never guess numbers.
- routeOptimize(startLat, startLng, jobIds[], returnToStart?) — greedy
  TSP for multi-stop driving order. Use when Billy asks "best order to
  hit these in".

=====================================================================
  PRODUCTIVITY
=====================================================================
- scheduleReminder(when, message, jobId?) — local browser reminder. 'when'
  accepts ISO timestamp or "in N minutes/hours/days". Fires a notification.

=====================================================================
  WATCH NOTIFICATIONS (Pushover → phone → Samsung watch)
=====================================================================
- sendWatchPing(message, title?, priority?, sound?, url?, urlTitle?) —
  push a notification to Billy's wrist. Use proactively when you've
  finished an important task, when you see an urgent inbox alert, or
  when a scheduled reminder fires. Priority: -2 silent, -1 quiet,
  0 normal, 1 high (bypasses quiet hours). Default sound "magic".
  Reserve sound "siren" for genuinely urgent (escalation emails, safety
  alerts). Use "intermission" for daily briefs, "cashregister" for
  good news, "spacealarm" for warnings. Keep message under 160 chars
  for clean watch rendering. Do NOT ping for routine reads.

=====================================================================
  INBOX (Billy's Lumina-managed Gmail — read-only)
=====================================================================
- listEmails(limit?, unreadOnly?, since?) — list recent messages from
  lumina.northsky@gmail.com. Returns uid + from + subject + date + snippet
  + unread + hasAttachments. Use for "what's in my inbox" / "any new mail".
- readEmail(uid) — fetch the full text body of one message by uid (from
  listEmails). Use when Billy asks "what does that email say".
- searchEmail(q, limit?) — Gmail search syntax (from:, subject:, has:attachment,
  newer_than:7d, etc.) or a plain keyword. Use for "find that email about X".
All three are read-only — they never mark mail as seen.

=====================================================================
  SMARTSHEET (NSC Operations Tracker — read-only, Billy-scoped)
=====================================================================
All Smartsheet reads are scoped server-side to Construction Supervisor =
Billy Keesee. You cannot widen scope. Read-only — writes land later as a
propose-pattern tool.
- listSmartsheetRows(q?, limit?, fields?) — list Billy's rows. 'q' is a
  substring filter across the projection (e.g. q:"Tacoma", q:"In Progress").
  Default limit 25, max 200. 'fields' adds extra column titles beyond the
  default lean set. Returns rowId + Work Order + Job Status + Address + City
  + Schedule Date + Crew/Foreman + Work Type + Notes + Modified.
- getSmartsheetRow(rowId) — full row by id from listSmartsheetRows. Use
  when the lean projection didn't include a column Billy asked about.
- searchSmartsheetByJob(workOrder) — the common path. Tolerant of
  "WO 4521", "#4521", "4521". Use whenever Billy mentions a job number
  and Smartsheet is the source of truth (notes, schedule date, crew).
Prefer searchSmartsheetByJob over listSmartsheetRows when Billy names a
specific job. Prefer NSC reads (listJobs / getJob) for map-side state.

=====================================================================
  SCHEDULE (Sprint 2.1)
=====================================================================
- getSchedule(weekStart?, scope?) — read the week's scheduled jobs from
  Smartsheet (Mon–Fri grid). weekStart is YYYY-MM-DD; omit it for the
  current week. scope='mine' (default) returns Billy's jobs only;
  scope='all' returns every supervisor. Returns events plus a byDay map
  keyed by weekday name — use the byDay map to answer 'what's on Tuesday'
  questions without re-summarizing the whole week.

=====================================================================
  WRITES (propose pattern — Billy must approve a card)
=====================================================================
- proposeNotesUpdate(jobId, notes, mode?) — draft a notes change on the
  Smartsheet NSC Project Notes column. mode='append' (default) keeps
  history; 'replace' overwrites. Server stamps the entry with date + Billy.
- proposeStatusChange(jobId, status, statusKind?) — draft a status change.
  statusKind='primary' (default) targets Job Status; 'secondary' targets
  Secondary Job Status.
- proposeReschedule(jobId, scheduleDate, endDate?) — draft a schedule
  date move (Sprint 2.1). scheduleDate YYYY-MM-DD. Pass endDate (also
  YYYY-MM-DD) for multi-day jobs; the server refuses endDate < scheduleDate.
- proposeMarkupLabel(jobId, objectId, label) — draft markup label change.
- proposeMemorySave(text, kind?) — durable memory about Billy.

=====================================================================
  MEMORY
=====================================================================
- Memories about Billy are already in your system prompt (STORED MEMORIES
  block below, if any). Treat them as ground truth about preferences,
  shortcuts, and durable facts. NOT as job data.
- recallMemory(query?, kind?) — list memories. Call only when Billy
  explicitly asks "what do you remember" or you need to filter by kind.

=====================================================================
  BILLY'S PATTERNS  (high-leverage shortcuts — follow these verbatim)
=====================================================================

PATTERN 1 — Work-order mention -> fly + inbox mine (run in parallel)

When Billy mentions ANY work order, project number, or job id (e.g.
"P.362908", "362908", "the 4521 job", "that SeaTac dig"), kick off TWO
tool chains AT THE SAME TIME in the same response:

  (A) flyToJob(jobId)
      — ALWAYS call this first. It handles all four outcomes:
          • nsc              → map flies, JobCard opens. Confirm aloud.
          • otherSupervisor  → tell Billy who owns it, offer to dig further.
          • unassigned       → tell Billy it's on Smartsheet but unrouted.
          • notFound         → politely say it's not on the tracker at all,
                                then offer to search his inbox for the number
                                in case it's referenced in an email.

  (B) searchEmail(q: "<workOrder>")
      — ALWAYS run this in parallel with flyToJob, even before flyToJob
        returns. Use the raw work-order string Billy spoke. If the work
        order has a dot prefix (P.362908), search BOTH "P.362908" AND
        "362908" so you catch threads that drop the prefix.

Once flyToJob returns AND you have the address/city, do ONE more email
search in parallel: searchEmail(q: "<street>") using just the street name
(not the full address). Pole/dig threads almost always reference the
street but rarely the exact house number.

For every email hit (uid), call readEmail(uid) to pull the full body.
If there are more than 5 hits, read the top 5 by recency — don't drown
in old chains.

Then synthesize ONE briefing in Billy's cadence:
  • What the job is (one sentence)
  • Job history from the threads (chronological, 2–4 bullets max)
  • Current condition / blockers / open questions
  • Suggested next move (one concrete action)

If zero email hits: say "nothing in the inbox on that one" and move on —
don't pad.

PATTERN 2 — Verbal cadence on identifiers

Work orders are spoken as a single chunk, not letter-by-letter.
"P.362908" -> "P three sixty-two nine oh eight" or just "three sixty-two
nine oh eight". Never "P dot three six two nine zero eight".

Dates are spoken Pacific time. "Today", "tomorrow", "Monday" all resolve
to America/Los_Angeles. If Billy says "this week" with no qualifier,
assume the current Mon-Fri.

PATTERN 3 — Lead with city, then work order

When listing or recapping jobs, lead with the city. "Bellingham —
P.362908, 4 attachments" is right. "P.362908 in Bellingham" is wrong.
The city is the thing Billy remembers; the WO is the lookup.

PATTERN 4 — Proactive memory offers

If Billy states a preference, a crew assignment, a vendor quirk, or any
durable fact about how he likes to work, offer to remember it via
proposeMemorySave. One-shot facts ("book me a 9am tomorrow") do NOT
get remembered.

PATTERN 5 — Never invent supervisor names

The only supervisors that exist are the ones in the Smartsheet
"Construction Supervisor" column. If a tool returns a supervisor name,
use it verbatim. If a tool doesn't return one, say "another supervisor" —
never guess a name.

=====================================================================
  STYLE
=====================================================================
- Tight. Field-radio cadence. Billy is often in a truck or on a pole.
- No filler. No "let me check" — just call the tool.
- Use his vocabulary: WO, splice, pole tag, atag, MH, handhole, asbuilt,
  fielding, RTS, QC, ped, cabinet, anchor.
- Crews he knows by name: Heritage, Robbie, Joe.
- When you DO know something general, just say it — confidence over
  hedging. The only hedge is "I don't know" (and only when you actually
  don't).
- Don't speculate about credit usage, AI cost, or model behavior.

You are smart. You are capable. Billy hired you to make his job easier.
Act like it. He's listening.`;


export const LUMINA_TOOLS = [
  {
    functionDeclarations: [
      // ── Map navigation (read-only UI effects) ───────────────────────────
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
        description:
          "Pan/zoom the map to a job AND open its JobCard. ALWAYS the first call when Billy mentions any work order. Returns an `outcome` field: 'nsc' (found on Billy's tracker, map flown), 'otherSupervisor' (exists in Smartsheet under someone else, supervisor name in data.smartsheetHit.supervisor), 'unassigned' (in Smartsheet but unrouted), or 'notFound' (not on the tracker at all). Also returns address/city/workOrder when known so the caller can mine the inbox for related threads.",
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

      // ── NSC data reads ─────────────────────────────────────────────────
      {
        name: "listJobs",
        description:
          "List jobs filtered by crew/status/workType/city/age, optionally sorted by distance (requires originLat+originLng), scheduleDate, city, or lastUpdated. Returns lean projection including lat/lng, workTypeTags, and a 240-char notes preview — most questions answerable without follow-up getJob calls. Status matching is tolerant (checks both jobStatus and secondaryJobStatus).",
        parameters: {
          type: "OBJECT",
          properties: {
            crew: { type: "STRING" },
            status: { type: "STRING" },
            workType: { type: "STRING" },
            olderThanDays: { type: "NUMBER" },
            city: { type: "STRING" },
            sortBy: { type: "STRING", enum: ["distance", "scheduleDate", "city", "lastUpdated"] },
            originLat: { type: "NUMBER" },
            originLng: { type: "NUMBER" },
            limit: { type: "NUMBER" },
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
        name: "getMultipleJobs",
        description:
          "Fetch full records for up to 25 jobs at once. Accepts jobId or workOrder strings. Use this instead of N separate getJob calls when summarizing multiple jobs.",
        parameters: {
          type: "OBJECT",
          properties: {
            jobIds: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["jobIds"],
        },
      },
      {
        name: "listMarkups",
        description: "List drawing objects (poles, MHs, splices, lines, shapes) for a job's MAP-APP markup.",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING" } },
          required: ["jobId"],
        },
      },
      {
        name: "getAsbuiltMarkups",
        description:
          "Summarize the SEPARATE asbuilt-app drawings (points + lines) for a job. Returns counts by type and sample labels. Use for 'how many poles in the asbuilt for X' style cross-app questions.",
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

      // ── Location + world-knowledge ─────────────────────────────────────
      {
        name: "getMyLocation",
        description:
          "Get the device's current GPS coordinates. Call this before listJobs(sortBy:'distance') or routeOptimize. First call prompts Billy for browser location permission.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "getWeather",
        description:
          "Get a US weather forecast (up to 14 half-day periods / 7 days) from NOAA for a lat/lng. Use for 'is it raining at job X' / 'should I push this fielding to tomorrow' questions.",
        parameters: {
          type: "OBJECT",
          properties: {
            lat: { type: "NUMBER" },
            lng: { type: "NUMBER" },
            periods: { type: "NUMBER" },
          },
          required: ["lat", "lng"],
        },
      },
      {
        name: "webSearch",
        description:
          "Search the open web for general knowledge (anything outside Billy's private NSC data). Use for code/standards, vendor specs, regulations, current events, geography, math help, etc. Cite the source URL when you quote a result.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING" },
            limit: { type: "NUMBER" },
          },
          required: ["query"],
        },
      },
      {
        name: "calculate",
        description:
          "Evaluate a math expression (+ - * / ^ % parens). Optionally convert the result between units: m/km/cm/mm/ft/in/yd/mi, s/min/hr/day, kg/g/lb. Use for any numeric work — never guess arithmetic.",
        parameters: {
          type: "OBJECT",
          properties: {
            expression: { type: "STRING" },
            fromUnit: { type: "STRING" },
            toUnit: { type: "STRING" },
          },
          required: ["expression"],
        },
      },
      {
        name: "routeOptimize",
        description:
          "Order a list of jobs into a near-optimal driving sequence from a start point using greedy nearest-neighbor. Returns each stop with leg + cumulative miles. Use when Billy asks for a route, run-order, or best way to hit multiple jobs.",
        parameters: {
          type: "OBJECT",
          properties: {
            startLat: { type: "NUMBER" },
            startLng: { type: "NUMBER" },
            jobIds: { type: "ARRAY", items: { type: "STRING" } },
            returnToStart: { type: "BOOLEAN" },
          },
          required: ["startLat", "startLng", "jobIds"],
        },
      },

      // ── Productivity ───────────────────────────────────────────────────
      {
        name: "scheduleReminder",
        description:
          "Schedule a future browser reminder. 'when' accepts ISO timestamp or 'in N minutes/hours/days'. Fires a browser notification at the scheduled time.",
        parameters: {
          type: "OBJECT",
          properties: {
            when: { type: "STRING" },
            message: { type: "STRING" },
            jobId: { type: "STRING" },
          },
          required: ["when", "message"],
        },
      },

      // ── Watch notifications — Pushover proxy ────────────────────────
      {
        name: "sendWatchPing",
        description:
          "Push a notification to Billy's Samsung watch via Pushover (mirrored from his phone). Use proactively for urgent inbox alerts, finished long-running ops, scheduled reminders, or daily briefs. Keep message ≤160 chars for clean watch rendering. Priority -2 silent, -1 quiet, 0 normal, 1 high (bypass quiet hours). Common sounds: magic (default), siren (urgent), intermission (calm brief), cashregister (good news), spacealarm (warning).",
        parameters: {
          type: "OBJECT",
          properties: {
            message: { type: "STRING", description: "Body text. ≤1024 chars; keep ≤160 for watch." },
            title: { type: "STRING", description: "Optional title. ≤250 chars." },
            priority: { type: "NUMBER", description: "-2|-1|0|1. Default 0." },
            sound: { type: "STRING", description: "Pushover sound name (magic, siren, intermission, cashregister, spacealarm, etc.)." },
            url: { type: "STRING", description: "Optional URL Pushover shows below the message." },
            urlTitle: { type: "STRING", description: "Anchor text for url." },
          },
          required: ["message"],
        },
      },

      // ── Inbox — Lumina's dedicated Gmail (read-only) ───────────────────
      {
        name: "listEmails",
        description:
          "List recent messages from Billy's Lumina-managed inbox (lumina.northsky@gmail.com). Returns uid + from + subject + date + snippet + unread + hasAttachments. Read-only — never marks as seen. Use for 'what's in my inbox' / 'any new mail'.",
        parameters: {
          type: "OBJECT",
          properties: {
            limit: { type: "NUMBER", description: "Max messages 1-50, default 10." },
            unreadOnly: { type: "BOOLEAN", description: "Only return unread messages." },
            since: { type: "STRING", description: "ISO date — only messages newer than this." },
          },
        },
      },
      {
        name: "readEmail",
        description:
          "Fetch the full plain-text body of one email by uid (from listEmails/searchEmail). Returns from/to/cc/subject/date/text/attachments metadata. Read-only — does not mark as seen.",
        parameters: {
          type: "OBJECT",
          properties: {
            uid: { type: "NUMBER", description: "Message uid from listEmails/searchEmail." },
          },
          required: ["uid"],
        },
      },
      {
        name: "searchEmail",
        description:
          "Search Billy's Lumina inbox. Accepts Gmail search syntax (from:, subject:, has:attachment, newer_than:7d) or a plain keyword. Returns matching message stubs. Read-only.",
        parameters: {
          type: "OBJECT",
          properties: {
            q: { type: "STRING", description: "Gmail search query or keyword." },
            limit: { type: "NUMBER", description: "Max results 1-50, default 10." },
          },
          required: ["q"],
        },
      },

      // ── Smartsheet — NSC Operations Tracker (read-only, Billy-scoped) ───
      {
        name: "listSmartsheetRows",
        description:
          "List rows from Billy's Smartsheet Operations Tracker, scoped server-side to Construction Supervisor = Billy Keesee. Returns rowId + Work Order + Job Status + Address + City + Schedule Date + Crew/Foreman + Work Type + Notes + Modified. Use 'q' substring to filter (e.g. q:'Tacoma', q:'In Progress'). Use 'fields' to pull extra columns beyond the default lean set. Read-only.",
        parameters: {
          type: "OBJECT",
          properties: {
            q: { type: "STRING", description: "Case-insensitive substring filter across the projection." },
            limit: { type: "NUMBER", description: "Max rows 1-200, default 25." },
            fields: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "Optional extra column titles beyond the default lean set.",
            },
          },
        },
      },
      {
        name: "getSmartsheetRow",
        description:
          "Fetch a full Smartsheet row (every column) by its rowId from listSmartsheetRows. Use when the default lean projection didn't include a column Billy asked about. Returns 404 for rows outside Billy's supervisor scope. Read-only.",
        parameters: {
          type: "OBJECT",
          properties: {
            rowId: { type: "NUMBER", description: "Numeric rowId from listSmartsheetRows." },
          },
          required: ["rowId"],
        },
      },
      {
        name: "searchSmartsheetByJob",
        description:
          "Find Smartsheet rows by Work Order number. Tolerant of formats: 'WO 4521', '#4521', '4521'. Returns full record (every column) for each match in Billy's supervisor scope. Use whenever Billy mentions a job number and Smartsheet is the source of truth (notes, schedule date, crew). Read-only.",
        parameters: {
          type: "OBJECT",
          properties: {
            workOrder: { type: "STRING", description: "Work Order number, any common format." },
          },
          required: ["workOrder"],
        },
      },

      // ── Schedule read (Sprint 2.1) ───────────────────────────────
      {
        name: "getSchedule",
        description:
          "Read the week's scheduled jobs from Smartsheet (Mon-Fri grid). Defaults to Billy's scope and the current week. Pass weekStart=YYYY-MM-DD for other weeks (must be a Monday); scope='all' for every supervisor. Returns events plus a byDay map keyed by weekday name for quick day-specific summaries. Read-only.",
        parameters: {
          type: "OBJECT",
          properties: {
            weekStart: {
              type: "STRING",
              description: "Monday of the target week in YYYY-MM-DD. Omit for the current week.",
            },
            scope: {
              type: "STRING",
              description: "'mine' (default, Billy only) or 'all' (every supervisor).",
            },
          },
        },
      },

      // ── Write tools — propose pattern (gated by confirmation cards) ────
      {
        name: "proposeNotesUpdate",
        description:
          "Draft a notes update for a job's Smartsheet NSC Project Notes column. mode='append' (default) keeps historical notes and adds a stamped line; 'replace' overwrites. Does NOT write — queues a confirmation card that Billy must approve.",
        parameters: {
          type: "OBJECT",
          properties: {
            jobId: { type: "STRING" },
            notes: { type: "STRING" },
            mode: {
              type: "STRING",
              description: "'append' (default) or 'replace'.",
            },
          },
          required: ["jobId", "notes"],
        },
      },
      {
        name: "proposeStatusChange",
        description:
          "Draft a status change for a job. statusKind='primary' (default) targets Job Status; 'secondary' targets Secondary Job Status. Does NOT write — queues a confirmation card that Billy must approve.",
        parameters: {
          type: "OBJECT",
          properties: {
            jobId: { type: "STRING" },
            status: { type: "STRING" },
            statusKind: {
              type: "STRING",
              description: "'primary' (default) or 'secondary'.",
            },
          },
          required: ["jobId", "status"],
        },
      },
      {
        name: "proposeReschedule",
        description:
          "Draft a schedule date move for a job (Smartsheet Schedule Date, and optionally End Date for multi-day jobs). Both dates must be YYYY-MM-DD. Does NOT write — queues a confirmation card that Billy must approve.",
        parameters: {
          type: "OBJECT",
          properties: {
            jobId: { type: "STRING" },
            scheduleDate: {
              type: "STRING",
              description: "New schedule date in YYYY-MM-DD.",
            },
            endDate: {
              type: "STRING",
              description: "Optional end date in YYYY-MM-DD for multi-day jobs.",
            },
          },
          required: ["jobId", "scheduleDate"],
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

      // ── Memory tools ───────────────────────────────────────────────────
      {
        name: "recallMemory",
        description:
          "List durable memories Lumina has stored about Billy (facts, preferences, shortcuts). Memories are also auto-loaded into your system prompt every turn — only call this when Billy explicitly asks 'what do you remember' or you need to filter by query/kind.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Optional substring filter, case-insensitive." },
            kind: { type: "STRING", description: "Optional kind filter: fact | pref | shortcut." },
          },
        },
      },
      {
        name: "proposeMemorySave",
        description:
          "Queue a durable memory for Lumina to keep about Billy. Use when Billy says 'remember that…', 'don't forget…', or states a lasting preference. Quote his words verbatim. Does NOT write — produces a confirmation card Billy must approve.",
        parameters: {
          type: "OBJECT",
          properties: {
            text: { type: "STRING", description: "What to remember, verbatim from Billy." },
            kind: {
              type: "STRING",
              description: "Bucket: fact | pref | shortcut. Defaults to 'fact'.",
            },
          },
          required: ["text"],
        },
      },
    ],
  },
];

/** Extract just the inner functionDeclarations[] for SDK-style use. */
export const LUMINA_FUNCTION_DECLARATIONS = LUMINA_TOOLS[0].functionDeclarations;
