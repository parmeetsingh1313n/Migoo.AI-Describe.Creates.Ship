import { describe, it, expect } from 'vitest';
import {
  SLIDE_ARCHETYPES,
  QNA_ARCHETYPES,
  QNA_TOPIC_PREFIX,
  CAPSTONE_ARCHETYPE,
  pickArchetype,
  pickNonCodeArchetype,
  componentName,
  isCodeArchetype,
  isCodeCompanionArchetype,
  isBuildTopic,
  isQnaTopic,
  isQnaArchetype,
  qnaArchetypeFor,
} from '../../data/slide-design';

// ═══════════════════════════════════════════════════════════════════════════════
// isBuildTopic — capstone/build slide detection
// ═══════════════════════════════════════════════════════════════════════════════

describe('isBuildTopic', () => {
  it('matches build/create/craft capstone headings', () => {
    expect(isBuildTopic('Build a Grading System With Conditionals')).toBe(true);
    expect(isBuildTopic('Building a REST API from scratch')).toBe(true);
    expect(isBuildTopic('Create a todo app with React state')).toBe(true);
    expect(isBuildTopic('Creating your first component')).toBe(true);
    expect(isBuildTopic('Crafting a custom hook')).toBe(true);
    expect(isBuildTopic('Putting it all together: the complete program')).toBe(true);
    expect(isBuildTopic('Capstone: number guessing game')).toBe(true);
    expect(isBuildTopic('Mini-project — temperature converter')).toBe(true);
  });

  it('does not match ordinary teaching topics', () => {
    expect(isBuildTopic('Understanding if/elif/else evaluation order')).toBe(false);
    expect(isBuildTopic('Comparison operators and truthiness')).toBe(false);
    expect(isBuildTopic('What is a variable?')).toBe(false);
    expect(isBuildTopic('')).toBe(false);
  });

  it('handles undefined-ish input without throwing', () => {
    expect(isBuildTopic(undefined as unknown as string)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAPSTONE_ARCHETYPE — must behave as a code + companion layout
// ═══════════════════════════════════════════════════════════════════════════════

describe('CAPSTONE_ARCHETYPE', () => {
  it('is named CODE + OUTPUT', () => {
    expect(componentName(CAPSTONE_ARCHETYPE)).toBe('CODE + OUTPUT');
  });

  it('is detected as a code archetype and a code-companion archetype', () => {
    expect(isCodeArchetype(CAPSTONE_ARCHETYPE)).toBe(true);
    expect(isCodeCompanionArchetype(CAPSTONE_ARCHETYPE)).toBe(true);
  });

  it('is NOT part of the rotation catalog (stride co-primality depends on length 35)', () => {
    expect(SLIDE_ARCHETYPES).not.toContain(CAPSTONE_ARCHETYPE);
    expect(SLIDE_ARCHETYPES.length).toBe(35);
  });

  it('demands the program output on screen', () => {
    expect(CAPSTONE_ARCHETYPE).toMatch(/OUTPUT card/i);
    expect(CAPSTONE_ARCHETYPE).toMatch(/NEVER metric tiles/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rotation invariants (regression guards for the co-prime stride)
// ═══════════════════════════════════════════════════════════════════════════════

describe('pickArchetype', () => {
  it('always gives COVER to slide 0', () => {
    for (let ch = 0; ch < 12; ch++) {
      expect(componentName(pickArchetype(ch, 0))).toBe('COVER');
    }
  });

  it('never gives COVER to a non-intro slide', () => {
    for (let ch = 0; ch < 12; ch++) {
      for (let si = 1; si < 25; si++) {
        expect(componentName(pickArchetype(ch, si))).not.toBe('COVER');
      }
    }
  });

  it('pickNonCodeArchetype never returns a code layout', () => {
    for (let ch = 0; ch < 12; ch++) {
      for (let si = 1; si < 25; si++) {
        expect(isCodeArchetype(pickNonCodeArchetype(ch, si))).toBe(false);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Q&A helpers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Q&A helpers', () => {
  it('isQnaTopic only matches the [Q&A] prefix', () => {
    expect(isQnaTopic(`${QNA_TOPIC_PREFIX} What is the output of this loop?`)).toBe(true);
    expect(isQnaTopic('  [Q&A] leading whitespace still counts')).toBe(true);
    expect(isQnaTopic('Build a Grading System')).toBe(false);
  });

  it('every Q&A archetype pins the question band on top', () => {
    for (const a of QNA_ARCHETYPES) {
      expect(isQnaArchetype(a)).toBe(true);
      expect(a).toMatch(/QUESTION in a full-width tinted band at the TOP/i);
    }
  });

  it('qnaArchetypeFor rotates through all four layouts', () => {
    const seen = new Set([0, 1, 2, 3].map((i) => qnaArchetypeFor(i)));
    expect(seen.size).toBe(QNA_ARCHETYPES.length);
    expect(qnaArchetypeFor(4)).toBe(qnaArchetypeFor(0));
  });

  it('Q&A layouts never leak into the teaching rotation', () => {
    for (const a of SLIDE_ARCHETYPES) {
      expect(isQnaArchetype(a)).toBe(false);
    }
  });
});
