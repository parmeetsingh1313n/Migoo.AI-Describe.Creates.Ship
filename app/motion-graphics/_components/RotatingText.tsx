'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface RotatingTextProps {
  texts: string[];
  duration?: number;
  yOffset?: number;
  className?: string;
}

export default function RotatingText({
  texts,
  duration = 2500,
  yOffset = -30,
  className = '',
}: RotatingTextProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (texts.length <= 1) return;
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % texts.length);
    }, duration);
    return () => clearInterval(interval);
  }, [texts, duration]);

  const hasJustify = className.includes('justify-');
  const alignClasses = hasJustify ? 'items-center' : 'justify-center items-center';

  return (
    <span className={`relative inline-flex overflow-hidden vertical-align-middle ${alignClasses} ${className}`}>
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          className="inline-block whitespace-nowrap"
          initial={{ opacity: 0, y: -yOffset }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: yOffset }}
          transition={{
            y: { type: 'spring', stiffness: 150, damping: 15 },
            opacity: { duration: 0.2 },
          }}
        >
          {texts[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
