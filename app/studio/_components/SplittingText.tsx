'use client';

import { motion } from 'framer-motion';

interface SplittingTextProps {
  text: string;
  type?: 'chars' | 'words' | 'lines';
  delay?: number;
  disableAnimation?: boolean;
  stagger?: number;
  className?: string;
}

export default function SplittingText({
  text,
  type = 'chars',
  delay = 0,
  disableAnimation = false,
  stagger = 0.04,
  className = '',
}: SplittingTextProps) {
  if (disableAnimation) {
    return <span className={className}>{text}</span>;
  }

  // Split by chars (default)
  const items = type === 'chars' ? text.split('') : text.split(' ');

  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: stagger,
        delayChildren: delay,
      },
    },
  };

  const childVariants = {
    hidden: { x: 40, opacity: 0, filter: 'blur(4px)' },
    visible: {
      x: 0,
      opacity: 1,
      filter: 'blur(0px)',
      transition: {
        type: 'spring' as const,
        stiffness: 120,
        damping: 14,
      },
    },
  };

  return (
    <motion.span
      className={`inline-flex flex-wrap ${className}`}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {items.map((item, index) => (
        <motion.span
          key={index}
          className="inline-block"
          style={{ whiteSpace: item === ' ' ? 'pre' : 'normal' }}
          variants={childVariants}
        >
          {item}
        </motion.span>
      ))}
    </motion.span>
  );
}
