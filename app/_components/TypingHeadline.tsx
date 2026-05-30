'use client';

import { useEffect, useRef, useState } from 'react';

interface TypingHeadlineProps {
  typedText?: string; // Default: "Learn Smarter with AI Video Courses"
  delay?: number;
  speed?: number;
  holdDelay?: number;
  loop?: boolean;
  className?: string;
}

export default function TypingHeadline({
  typedText = "Learn Smarter with AI Video Courses",
  delay = 500,
  speed = 60,
  holdDelay = 3500,
  loop = true,
  className = '',
}: TypingHeadlineProps) {
  const [displayed, setDisplayed] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const alive = useRef(true);

  const splitIndex = 19; // Length of "Learn Smarter with "

  useEffect(() => {
    alive.current = true;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = setTimeout(resolve, ms);
        return () => clearTimeout(id);
      });

    async function run() {
      // initial delay before typing starts
      await sleep(delay);
      if (!alive.current) return;

      while (alive.current) {
        // ── TYPING ────────────────────────────────
        setIsTyping(true);
        for (let i = 0; i <= typedText.length; i++) {
          if (!alive.current) return;
          setDisplayed(typedText.slice(0, i));
          await sleep(speed);
        }

        if (!loop) {
          setIsTyping(false);
          break;
        }

        // ── HOLD ──────────────────────────────────
        setIsTyping(false);
        await sleep(holdDelay);
        if (!alive.current) return;

        // ── ERASING ───────────────────────────────
        setIsTyping(true);
        for (let i = typedText.length; i >= 0; i--) {
          if (!alive.current) return;
          setDisplayed(typedText.slice(0, i));
          await sleep(speed * 0.45); // Erase quickly
        }
        setIsTyping(false);
        await sleep(speed * 4); // Pause before restarting
      }
    }

    run();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedText, delay, speed, holdDelay, loop]);

  // Split the typed string into the standard text and the blue primary text
  const part1 = displayed.slice(0, splitIndex);
  const part2 = displayed.slice(splitIndex);

  // Choose cursor color based on current typing position
  const currentCursorColor = displayed.length > splitIndex ? '#3363AD' : '#111111';

  return (
    <>
      <style>{`
        @keyframes typing-cursor-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        .typing-cursor {
          display: inline-block;
          width: 3.5px;
          height: 0.85em;
          border-radius: 2px;
          margin-left: 4px;
          vertical-align: middle;
          animation: typing-cursor-blink 0.75s step-end infinite;
          transition: background-color 0.25s ease;
        }
      `}</style>

      <h2 
        className={className}
        style={{
          fontFamily: "'Instrument Serif', serif",
          fontStyle: 'italic',
          fontWeight: 700, // Make whole line bold
          letterSpacing: '-0.3px',
          lineHeight: '1.25',
        }}
      >
        <span style={{ color: '#111111' }}>
          {part1}
        </span>
        <span style={{ color: '#3363AD' }}>
          {part2}
        </span>
        <span
          className="typing-cursor"
          style={{ 
            backgroundColor: currentCursorColor
          }}
        />
      </h2>
    </>
  );
}
