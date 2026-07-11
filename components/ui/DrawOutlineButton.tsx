'use client';

import { ReactNode } from "react";
import Link from "next/link";

interface DrawOutlineButtonProps {
    children: ReactNode;
    onClick?: () => void;
    className?: string;
    fullWidth?: boolean;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    id?: string;
    /** 'dark' = white idle text (for buttons sitting on a dark background). Default 'light' = dark idle text (for light backgrounds). */
    variant?: "light" | "dark";
    /** Hex/CSS color for the draw-in outline + hover text. Defaults to indigo to match the original design. */
    accentColor?: string;
    /** When set, renders an <a> instead of a <button> (e.g. downloads, Link-wrapped navigation) — same visual treatment either way. */
    href?: string;
    download?: string | boolean;
    target?: string;
    rel?: string;
}

const DrawOutlineButton = ({
    children,
    onClick,
    className = "",
    fullWidth = true,
    type = "button",
    disabled = false,
    id,
    variant = "light",
    accentColor = "#4f46e5", // indigo-600 — matches the original design
    href,
    download,
    target,
    rel,
}: DrawOutlineButtonProps) => {
    const idleTextClass = variant === "dark" ? "text-white" : "text-slate-900";

    const sharedClassName = `group relative px-6 py-3 font-medium ${idleTextClass} transition-colors duration-[400ms] bg-transparent rounded-lg ${fullWidth ? 'w-full' : ''
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`;

    const sharedStyle = { ['--draw-outline-accent' as string]: accentColor } as React.CSSProperties;

    const content = (
        <>
            <span
                className="relative z-10 inline-flex items-center justify-center gap-2 transition-colors duration-[400ms] group-hover:[color:var(--draw-outline-accent)]"
            >
                {children}
            </span>
            {/* TOP */}
            <span className="absolute left-0 top-0 h-[2px] w-0 transition-all duration-100 group-hover:w-full" style={{ background: accentColor }} />
            {/* RIGHT */}
            <span className="absolute right-0 top-0 h-0 w-[2px] transition-all delay-100 duration-100 group-hover:h-full" style={{ background: accentColor }} />
            {/* BOTTOM */}
            <span className="absolute bottom-0 right-0 h-[2px] w-0 transition-all delay-200 duration-100 group-hover:w-full" style={{ background: accentColor }} />
            {/* LEFT */}
            <span className="absolute bottom-0 left-0 h-0 w-[2px] transition-all delay-300 duration-100 group-hover:h-full" style={{ background: accentColor }} />
        </>
    );

    if (href) {
        // Internal navigation (no `download`) uses Next's <Link> for client-side
        // routing/prefetching. `download` requires a real <a> tag — browsers
        // won't honor the attribute on anything else.
        if (download) {
            return (
                <a
                    id={id}
                    href={disabled ? undefined : href}
                    onClick={disabled ? (e) => e.preventDefault() : onClick}
                    download={download}
                    target={target}
                    rel={rel}
                    aria-disabled={disabled}
                    className={sharedClassName}
                    style={sharedStyle}
                >
                    {content}
                </a>
            );
        }
        return (
            <Link
                id={id}
                href={disabled ? '#' : href}
                onClick={disabled ? (e) => e.preventDefault() : onClick}
                target={target}
                rel={rel}
                aria-disabled={disabled}
                className={sharedClassName}
                style={sharedStyle}
            >
                {content}
            </Link>
        );
    }

    return (
        <button
            id={id}
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={sharedClassName}
            style={sharedStyle}
        >
            {content}
        </button>
    );
};

export default DrawOutlineButton;
