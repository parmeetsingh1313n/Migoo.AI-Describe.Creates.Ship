'use client';

import { ReactNode } from "react";

interface DrawOutlineButtonProps {
    children: ReactNode;
    onClick?: () => void;
    className?: string;
    fullWidth?: boolean;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    id?: string;
}

const DrawOutlineButton = ({
    children,
    onClick,
    className = "",
    fullWidth = true,
    type = "button",
    disabled = false,
    id
}: DrawOutlineButtonProps) => {
    return (
        <button
            id={id}
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={`group relative px-6 py-3 font-medium text-slate-900 transition-colors duration-[400ms] hover:text-indigo-600 bg-transparent rounded-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-slate-900 ${fullWidth ? 'w-full' : ''
                } ${className}`}
        >
            <span className="relative z-10 inline-flex items-center justify-center gap-2">{children}</span>
            {/* TOP */}
            <span className="absolute left-0 top-0 h-[2px] w-0 bg-indigo-600 transition-all duration-100 group-hover:w-full" />
            {/* RIGHT */}
            <span className="absolute right-0 top-0 h-0 w-[2px] bg-indigo-600 transition-all delay-100 duration-100 group-hover:h-full" />
            {/* BOTTOM */}
            <span className="absolute bottom-0 right-0 h-[2px] w-0 bg-indigo-600 transition-all delay-200 duration-100 group-hover:w-full" />
            {/* LEFT */}
            <span className="absolute bottom-0 left-0 h-0 w-[2px] bg-indigo-600 transition-all delay-300 duration-100 group-hover:h-full" />
        </button>
    );
};

export default DrawOutlineButton;