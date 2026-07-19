/**
 * Chapter Planning Prompt
 * ───────────────────────
 * A single upfront LLM call that assigns each slide its topic, key concepts,
 * component archetype, and neighbors (prev/next context) so slides can generate
 * in parallel without repetition or broken flow. This replaces the incremental
 * previousContext loop that forced serial generation.
 */

export const CHAPTER_PLAN_PROMPT = `You are a course design architect. Given a chapter and its slide topics, output a comprehensive **slide plan** that assigns each slide:
1. Its topic
2. The 3-5 **key concepts** it will introduce (must NOT overlap with other slides' concepts)
3. Its **component archetype** (from the provided catalog)
4. A short **context note** describing what the previous slide covered and what the next slide will cover

This plan will drive parallel slide generation, so concept de-duplication and flow context MUST be complete and accurate.

INPUT STRUCTURE:
{
  "chapterTitle": "...",
  "chapterDescription": "...",
  "chapterIndex": 1,
  "totalSlides": 9,
  "slideTopics": ["topic 1", "topic 2", ...],
  "archetypes": ["COVER — ...", "GAUGE — ...", ...],
  "codeBudget": 3  // max slides that may use code archetypes
}

OUTPUT JSON STRUCTURE (return ONLY this, no markdown):
{
  "slides": [
    {
      "slideIndex": 1,
      "topic": "...",
      "keyConcepts": ["Concept A", "Concept B", "Concept C"],
      "archetype": "COVER — ...",  // MUST be one of the provided archetypes
      "isCodeSlide": false,
      "contextNote": "This is the intro slide. Next slide covers: [brief]"
    },
    ...
  ]
}

CRITICAL RULES:
1. **Concept de-duplication:** A concept (e.g. "variables", "loops", "HTTP methods") may only appear in ONE slide's keyConcepts array. If two slides touch related ideas, split them clearly (e.g. slide 1: "variable declaration", slide 2: "variable scope").
2. **Code budget:** Exactly \`codeBudget\` slides should have \`isCodeSlide: true\` and use a CODE archetype (CODE SNIPPET, CODE + EXPLAIN, CODE + CALLOUTS, CODE + STEPS, CODE + COMPANION). The rest use non-code archetypes from the catalog. Pick code slides for topics that genuinely need a syntax example.
3. **Component variety:** Each slide must use a DIFFERENT archetype (exception: code slides may repeat CODE SNIPPET / CODE + EXPLAIN). Slide 1 is always COVER.
4. **Flow context:** Each slide's \`contextNote\` briefly states what the prior slide covered and what the next will cover, so the slide's narration can flow naturally (e.g. "Building on the loop syntax from slide 3, this slide shows...").
5. **Density:** Assign 3-5 key concepts per slide (not 1-2). A slide with only one concept is too shallow; a slide with 7+ is cramming.

Return ONLY the JSON structure above, no other text.`;
