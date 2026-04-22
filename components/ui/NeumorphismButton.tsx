'use client';

import { ReactNode } from "react";
import { FiSend } from "react-icons/fi";

interface NeumorphismButtonProps {
    children: ReactNode;
    onClick?: () => void;
    className?: string;
    withIcon?: boolean;
}

const NeumorphismButton = ({
    children,
    onClick,
    className = "",
    withIcon = false
}: NeumorphismButtonProps) => {
    return (
        <button
            onClick={onClick}
            className={`
        px-5 py-2.5 rounded-full 
        flex items-center gap-2 
        text-violet-800 cursor-pointer text-sm font-medium
        shadow-[-5px_-5px_10px_rgba(255,_255,_255,_0.8),_5px_5px_10px_rgba(0,_0,_0,_0.25)]
        
        transition-all duration-300

        hover:shadow-[-1px_-1px_5px_rgba(255,_255,_255,_0.6),_1px_1px_5px_rgba(0,_0,_0,_0.3),inset_-2px_-2px_5px_rgba(255,_255,_255,_1),inset_2px_2px_4px_rgba(0,_0,_0,_0.3)]
        hover:text-black
        hover:scale-105
        active:scale-95
        ${className}
    `}
        >
            {withIcon && <FiSend className="text-current" />}
            <span>{children}</span>
        </button>
    );
};

export default NeumorphismButton;