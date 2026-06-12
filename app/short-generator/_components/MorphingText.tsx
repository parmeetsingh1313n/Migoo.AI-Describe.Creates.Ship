'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface MorphingTextProps {
  texts: [string, string][];
  holdDelay?: number;
  className?: string;
  part1ClassName?: string;
  part2ClassName?: string;
}

export default function MorphingText({
  texts,
  holdDelay = 3000,
  className = '',
  part1ClassName = 'text-foreground',
  part2ClassName = 'text-primary',
}: MorphingTextProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (texts.length <= 1) return;
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % texts.length);
    }, holdDelay);
    return () => clearInterval(interval);
  }, [texts, holdDelay]);

  const [part1, part2] = texts[index];
  const part1Words = part1.split(' ');
  const part2Words = part2.split(' ');

  const letterVariants = {
    hidden: { opacity: 0, y: 8, filter: 'blur(8px)', scale: 0.8 },
    visible: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      scale: 1,
      transition: {
        type: 'spring' as const,
        stiffness: 130,
        damping: 20,
        mass: 0.4,
      },
    },
    exit: {
      opacity: 0,
      y: -8,
      filter: 'blur(8px)',
      scale: 0.8,
      transition: {
        duration: 0.18,
      },
    },
  };

  return (
    <div className={`relative inline-flex flex-wrap justify-center items-center ${className}`}>
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          className="inline-flex flex-wrap justify-center gap-x-2"
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={{
            hidden: {},
            visible: {
              transition: {
                staggerChildren: 0.02,
              },
            },
            exit: {
              transition: {
                staggerChildren: 0.015,
                staggerDirection: -1,
              },
            },
          }}
        >
          {/* Part 1 (Off-black/default) */}
          {part1Words.map((word, wordIndex) => (
            <span key={`p1-${wordIndex}`} className={`inline-block whitespace-nowrap ${part1ClassName}`}>
              {word.split('').map((char, charIndex) => (
                <motion.span
                  key={charIndex}
                  className="inline-block"
                  variants={letterVariants}
                >
                  {char}
                </motion.span>
              ))}
            </span>
          ))}

          {/* Part 2 (Highlighted Gradient) */}
          {part2Words.map((word, wordIndex) => (
            <span key={`p2-${wordIndex}`} className={`inline-block whitespace-nowrap ${part2ClassName}`}>
              {word.split('').map((char, charIndex) => (
                <motion.span
                  key={charIndex}
                  className="inline-block"
                  variants={letterVariants}
                >
                  {char}
                </motion.span>
              ))}
            </span>
          ))}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
