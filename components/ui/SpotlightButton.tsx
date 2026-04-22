'use client';

import { motion } from "framer-motion";
import { useEffect, useRef, ReactNode } from "react";

interface SpotlightButtonProps {
    children: ReactNode;
    onClick?: () => void;
    className?: string;
    fullWidth?: boolean;
    type?: "button" | "submit" | "reset";
}

const SpotlightButton = ({
    children,
    onClick,
    className = "",
    fullWidth = true,
    type = "button"
}: SpotlightButtonProps) => {
    const btnRef = useRef<HTMLButtonElement>(null);
    const spanRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const btn = btnRef.current;
        const span = spanRef.current;

        if (!btn || !span) return;

        const handleMouseMove = (e: MouseEvent) => {
            const target = e.currentTarget as HTMLElement;
            if (!target) return;

            const { width } = target.getBoundingClientRect();
            const offset = e.offsetX;
            const left = `${(offset / width) * 100}%`;

            span.animate({ left }, { duration: 250, fill: "forwards" });
        };

        const handleMouseLeave = () => {
            span.animate(
                { left: "50%" },
                { duration: 100, fill: "forwards" }
            );
        };

        btn.addEventListener("mousemove", handleMouseMove);
        btn.addEventListener("mouseleave", handleMouseLeave);

        return () => {
            btn.removeEventListener("mousemove", handleMouseMove);
            btn.removeEventListener("mouseleave", handleMouseLeave);
        };
    }, []);

    return (
        <motion.button
            whileTap={{ scale: 0.985 }}
            ref={btnRef}
            type={type}
            onClick={onClick}
            className={`relative overflow-hidden rounded-lg bg-slate-950 px-4 py-3 text-lg font-medium text-white ${fullWidth ? 'w-full' : 'max-w-xs'
                } ${className}`}
        >
            <span className="pointer-events-none relative z-10 mix-blend-difference">
                {children}
            </span>
            <span
                ref={spanRef}
                className="pointer-events-none absolute left-[50%] top-[50%] h-32 w-32 -translate-x-[50%] -translate-y-[50%] rounded-full bg-slate-100"
            />
        </motion.button>
    );
};

export default SpotlightButton;