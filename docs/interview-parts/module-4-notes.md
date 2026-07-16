## Module 4 — Notes Generator

### 1. One-line purpose & user journey

**Purpose:** Turn any source (typed text, an uploaded document, a topic, or a URL) into **beautifully styled AI study notes / infographics** that can be exported as PNG or PDF. Six visual styles (Cornell, mindmap, flashcard, infographic, cheatsheet, timeline) over decorative page designs.

**User journey:**
1. `app/notes` → create a note: choose a **source type** (`text | document | topic | url`), provide the content, pick a **note style** and a **page design**.
2. If a document is uploaded, `[id]/process-doc` extracts text (and images) from it; images can be analyzed via Groq Vision.
3. `[id]/generate` runs the **chunked notes generator** to produce structured JSON, then renders it to styled HTML.
4. Optional decorative images are generated (`[id]/generate-images`, `[id]/cover-image`).
5. The user views the note (`app/notes/[noteId]`) rendered with the chosen design (`NoteDesigns.tsx`, `PageDecorations.tsx`) and **exports** to PNG/PDF client-side.

### 2. Tech stack in THIS module

- **Chunked LLM generation** — `lib/chunked-notes-generator.ts`: a **tiered model strategy** (Mistral-Large-3-675B → GPT-oss-120b → Llama-3.3-70B) with a **smart content sampler** that fits long documents into the model's context (head + evenly-distributed section excerpts + tail).
- **Groq Vision** — `analyzeImageWithGroq` (llama-4-scout) extracts text/data/structure from uploaded images/charts so they can be referenced in notes; auto-converts AVIF/HEIC/TIFF → JPEG via `sharp`.
- **Sarvam Document Intelligence** — for document extraction (via the shared `sarvam-doc` job flow).
- **Client-side export** — `html-to-image` / `html2canvas-pro` → PNG, `jsPDF` / `pdf-lib` → PDF.
- **Storage** — Appwrite; **DB** — `notesProjects` (`sourceContent`, `extractedContent`, `generatedData`, `generatedHtml`, `exportUrl`).

### 3. Pipeline stage by stage (exact files/functions)

| # | File / function | What happens |
|---|---|---|
| 0 | `app/api/notes/route.ts` (POST) | Create `notesProjects` row (status `draft`) with `noteStyle` + `pageDesign`. |
| 1 | `[id]/upload/route.ts` + `[id]/process-doc/route.ts` | Store the file; extract text/images (Sarvam doc + Groq Vision). Fills `extractedContent` / `uploadedAssets`. |
| 2 | `[id]/generate/route.ts` → `lib/chunked-notes-generator.ts` (`generateNotesWithChunking`) | Sample the content to fit a tier, call the LLM, produce **structured JSON** (`generatedData`). |
| 3 | (render) | Convert structured JSON → `generatedHtml` for the chosen `noteStyle`. |
| 4 | `[id]/generate-images/route.ts` + `[id]/cover-image/route.ts` → `lib/notes-image-gen.ts` | Generate decorative/section images + a cover. |
| 5 | `app/notes/[noteId]/*` (`NoteDesigns.tsx`, `PageDecorations.tsx`) | Render the note in the selected design. |
| 6 | Client export | `html-to-image` → PNG, `jsPDF`/`pdf-lib` → PDF; store `exportUrl`. |
| — | `app/api/course-notes/generate/route.ts` | Sibling: generate notes directly from a course chapter. |
| — | `app/api/enhance-point/route.ts` | LLM "expand this point" helper inside a note. |

### 4. File-by-file table

| Path | What | Why |
|---|---|---|
| `app/notes/page.tsx` | Notes list + create entry | Module home |
| `app/notes/[noteId]/page.tsx` | Note viewer + export controls | Render + export |
| `app/notes/[noteId]/NoteDesigns.tsx` | The 6 note-style templates | Visual styles |
| `app/notes/[noteId]/PageDecorations.tsx` | Botanical/pastel/pebble/leaf page designs | Decoration layer |
| `app/api/notes/route.ts` | Create/list notes | CRUD |
| `app/api/notes/[id]/route.ts` | Get/update a note | State |
| `app/api/notes/[id]/process-doc/route.ts` | Extract text/images from an uploaded doc | Ingestion |
| `app/api/notes/[id]/generate/route.ts` | Structured-notes generation (Groq/aiFallback + Vision) | Core generation |
| `app/api/notes/[id]/generate-images/route.ts` + `cover-image/route.ts` | Decorative + cover images | Visuals |
| `lib/chunked-notes-generator.ts` | Tiered model + smart content sampler + structured JSON | The generation engine |
| `lib/notes-image-gen.ts` | Note decoration/image generation | Visuals |
| `app/api/course-notes/generate/route.ts` | Notes from a course chapter | Cross-module reuse |
| `config/schema.tsx` | `notesProjects` | Data model |

### 5. Interview-relevant code snippets

**a. Tiered model strategy** (`lib/chunked-notes-generator.ts`):
```ts
const TIERS = [
  { model: "mistralai/mistral-large-3-675b-instruct-2512", maxContentChars: 300_000, maxOutputTokens: 12_000, headChars: 10_000, tailChars: 5_000 },
  { model: "openai/gpt-oss-120b",     maxContentChars: 1_200_000, /* … */ },
  { model: "meta/llama-3.3-70b-instruct", maxContentChars: 1_200_000, /* … */ },
];
```
*If a tier hits a 413/429 (too big / rate-limited), it drops to a higher-capacity tier automatically.*

**b. Smart content sampler** — instead of naive truncation, it keeps the **head** (intro/objectives), **evenly-distributed section excerpts** (via `detectHeadings`), and the **tail** (conclusion/references), so long docs stay coherent within the token budget.

**c. Vision format guard** (`app/api/notes/[id]/generate/route.ts`):
```ts
const groqSupported = ["image/jpeg","image/png","image/gif","image/webp"];
if (!groqSupported.includes(mimeType)) {
  const sharp = (await import("sharp")).default;      // AVIF/HEIC/TIFF → JPEG
  finalBase64 = (await sharp(Buffer.from(imageBuffer)).jpeg({ quality: 90 }).toBuffer()).toString("base64");
}
```

**d. Structured note JSON** → the render layer maps `generatedData` (sections/cards/points) onto the selected `noteStyle` template in `NoteDesigns.tsx`.

**e. Client-side export** — the note DOM node is rasterized with `html-to-image` (PNG) or drawn into `jsPDF`/`pdf-lib` (PDF) entirely in the browser — no server render needed.

### 6. Likely interview Q&A

**Q1. Why chunk the generation instead of one call?** Source documents can be hundreds of thousands of characters — far past any model's context. The smart sampler fits the most informative slices (head + section excerpts + tail) into the tier's budget, and the tier ladder escalates to a higher-capacity model on 413/429. This keeps generation reliable regardless of input size.

**Q2. How do you keep long notes coherent across chunks?** The sampler is structure-aware: `detectHeadings` finds section boundaries and takes representative excerpts spread through the document (not a blind middle cut), plus the intro and conclusion verbatim — so the model always sees the document's arc, not a random fragment.

**Q3. How does client-side PNG/PDF export work?** The rendered note is a styled DOM subtree; `html-to-image`/`html2canvas-pro` rasterize it to a PNG data URL, and `jsPDF`/`pdf-lib` place that (or vector content) into a PDF — all in the browser, so exports are instant and don't consume server compute.

**Q4. How are the 6 note styles implemented?** As distinct templates in `NoteDesigns.tsx` that consume the same `generatedData` structured JSON; the chosen `noteStyle`/`pageDesign` (stored on the row) selects the template + `PageDecorations.tsx` background. One data model, many renderers.

**Q5. How are uploaded charts/screenshots used in notes?** They're analyzed by Groq Vision (`analyzeImageWithGroq`) into a detailed text description (data points, axes, UI elements), which is fed into the generation prompt so the note can reference the image's content accurately. Unsupported formats are converted to JPEG with `sharp` first.

**Q6. Why Groq here rather than the NVIDIA router?** Notes generation is text-structuring + vision, where Groq's Llama-3.3/llama-4-scout are fast and cheap on the free tier; the module explicitly uses `aiFallback`/`groq` (the header comment even says "Groq Only, NO Gemini"). The chunked generator additionally uses NVIDIA-hosted Mistral/GPT-oss/Llama tiers for the heavy structuring pass.
