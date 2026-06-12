'use client';

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

interface RollingTextProps {
  text: string;
  delay?: number;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function RollingText({
  text,
  delay = 0,
  duration = 0.65,
  className = '',
  style,
}: RollingTextProps) {
  const containerRef = useRef(null);
  const isInView = useInView(containerRef, { once: true, margin: '-10%' });

  // Split text into characters including spaces
  const chars = text.split('');

  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.025,
        delayChildren: delay,
      },
    },
  };

  const charVariants = {
    hidden: { y: 0 },
    visible: {
      y: '-100%',
      transition: {
        duration: duration,
        ease: [0.16, 1, 0.3, 1] as any, // Custom premium easeOutExpo curve
      },
    },
  };

  return (
    <motion.span
      ref={containerRef}
      className={`inline-flex flex-wrap overflow-hidden select-none py-1 ${className}`}
      style={style}
      variants={containerVariants}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
    >
      {chars.map((char, index) => {
        if (char === ' ') {
          return (
            <span key={index} className="inline-block whitespace-pre">
              {' '}
            </span>
          );
        }

        return (
          <span
            key={index}
            className="relative inline-block overflow-hidden h-[1.25em] leading-[1.25em]"
          >
            {/* The vertical rolling wrapper */}
            <motion.span
              className="block"
              variants={charVariants}
            >
              {/* Top/Initial letter */}
              <span className="block text-current">{char}</span>
              {/* Bottom/Rolled letter */}
              <span className="block absolute top-full left-0 text-current">
                {char}
              </span>
            </motion.span>
          </span>
        );
      })}
    </motion.span>
  );
}
