'use client';

import { LucideIcon } from 'lucide-react';

interface StudioFeatureCardProps {
  label: string;
  desc: string;
  color: string;
  icon: LucideIcon;
}

export default function StudioFeatureCard({ label, desc, color, icon: Icon }: StudioFeatureCardProps) {
  return (
    <div className="relative pt-8 group cursor-default transition-all duration-300">
      {/* ── Outer Dot Grid Box ── */}
      <style>{`
        .feature-dot-grid {
          background-image: radial-gradient(circle, #e2e8f0 1.2px, transparent 1.2px);
          background-size: 20px 20px;
        }
      `}</style>
      
      {/* ── Rotated Parent with grid background ── */}
      <div className="absolute inset-0 -m-3 p-3 rounded-[32px] feature-dot-grid opacity-70 border border-slate-100 shadow-[inset_0_0_20px_rgba(226,232,240,0.4)]" />

      {/* ── Main Folder Card Body ── */}
      <div 
        className="relative z-20 bg-[#ECEFF3] rounded-b-[28px] rounded-tr-[28px] rounded-tl-none border-[5px] border-[#D9E0E6] p-6 shadow-[0_12px_36px_-12px_rgba(0,0,0,0.08)] transition-all duration-500 hover:shadow-[0_20px_48px_-10px_rgba(0,0,0,0.12)] hover:-rotate-1.5 hover:-translate-y-1"
        style={{
          fontFamily: "'Outfit', sans-serif",
          minHeight: '220px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center'
        }}
      >
        {/* ── Thick Folder Tab (Nested for Perfect Left Alignment) ── */}
        <div className="absolute top-[-36px] left-[-5px] h-9 w-40 bg-[#ECEFF3] border-t-[5px] border-l-[5px] border-r-[5px] border-[#D9E0E6] rounded-t-[22px] z-30 transition-transform duration-300 group-hover:scale-y-105 origin-bottom" />

        {/* Beautiful Centered Sprint-Style White Capsule Card */}
        <div className="w-full bg-white rounded-2xl p-5 shadow-[0_6px_20px_rgba(0,0,0,0.03)] border border-black/[0.03] flex flex-col items-center text-center gap-2">
          {/* Animated Gradient Icon */}
          <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center shrink-0 shadow-md transform group-hover:scale-110 transition-transform duration-300`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          
          {/* Title */}
          <h3 className="text-[16px] font-bold text-slate-800 tracking-tight leading-tight mt-1">{label}</h3>
          
          {/* Description */}
          <p className="text-[12px] text-slate-400 font-medium leading-normal max-w-[200px]">{desc}</p>
        </div>
      </div>
    </div>
  );
}
