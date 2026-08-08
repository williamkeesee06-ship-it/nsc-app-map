import React from "react";

interface SapphireGlassCardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  headerTitle?: string;
  headerBadge?: string;
  style?: React.CSSProperties;
}

/**
 * 3D Titanium Hex Bolt (Vector SVG)
 * High-precision 6-sided Allen/Torx socket bolt with specular highlights.
 */
export const TitaniumHexBolt: React.FC<{ size?: number; className?: string }> = ({
  size = 14,
  className = "",
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`shrink-0 select-none ${className}`}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="hexBoltMetal" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="30%" stopColor="#e2e8f0" />
          <stop offset="65%" stopColor="#94a3b8" />
          <stop offset="90%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1e293b" />
        </radialGradient>
        <linearGradient id="hexSocketShadow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#090b0e" />
          <stop offset="60%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
      </defs>

      {/* Outer Washer Shadow */}
      <circle cx="12" cy="12" r="11" fill="none" stroke="#0f172a" strokeWidth="1" opacity="0.6" />

      {/* Outer Polished Titanium Ring */}
      <circle cx="12" cy="12" r="10" fill="url(#hexBoltMetal)" stroke="#cbd5e1" strokeWidth="1" />

      {/* Inner Recessed Bevel */}
      <circle cx="12" cy="12" r="7.5" fill="#334155" stroke="#0f172a" strokeWidth="0.8" />

      {/* 6-Sided Hex Socket */}
      <polygon
        points="12,5.5 17,8.4 17,14.6 12,17.5 7,14.6 7,8.4"
        fill="url(#hexSocketShadow)"
        stroke="#64748b"
        strokeWidth="0.75"
      />

      {/* Specular White Center Pin Reflection */}
      <circle cx="12" cy="12" r="1.5" fill="#f8fafc" opacity="0.85" />
    </svg>
  );
};

/**
 * Sapphire HUD Glass Card Component
 * Translucent dark sapphire glass widget with 45-degree chamfered mirror-chrome bezels
 * and Laser Royal Blue edge illumination.
 */
export const SapphireGlassCard: React.FC<SapphireGlassCardProps> = ({
  children,
  className = "",
  glow = false,
  headerTitle,
  headerBadge,
  style,
}) => {
  return (
    <div
      style={style}
      className={`relative group rounded-xl p-3.5 transition-all duration-200 backdrop-blur-md ${
        glow
          ? "bg-slate-900/85 border-2 border-blue-500/80 shadow-[0_0_20px_rgba(37,99,235,0.4),inset_0_0_12px_rgba(59,130,246,0.25)]"
          : "bg-slate-900/75 border border-slate-400/40 hover:border-slate-300/80 shadow-[0_6px_20px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]"
      } ${className}`}
    >
      {/* Corner Titanium Rivets */}
      <TitaniumHexBolt size={11} className="absolute top-2 left-2 opacity-70 group-hover:opacity-100 transition-opacity" />
      <TitaniumHexBolt size={11} className="absolute top-2 right-2 opacity-70 group-hover:opacity-100 transition-opacity" />

      {/* Optional Card Header */}
      {headerTitle && (
        <div className="flex items-center justify-between gap-2 pb-2 mb-2.5 border-b border-slate-700/80 pl-4 pr-4">
          <span className="text-xs font-black uppercase tracking-wider text-slate-200 font-['Audiowide']">
            {headerTitle}
          </span>
          {headerBadge && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-widest bg-blue-600/30 text-blue-400 border border-blue-500/50 shadow-[0_0_8px_rgba(37,99,235,0.5)]">
              {headerBadge}
            </span>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="relative z-10">{children}</div>

      {/* Bottom Corner Titanium Rivets */}
      <TitaniumHexBolt size={11} className="absolute bottom-2 left-2 opacity-50 group-hover:opacity-90 transition-opacity" />
      <TitaniumHexBolt size={11} className="absolute bottom-2 right-2 opacity-50 group-hover:opacity-90 transition-opacity" />
    </div>
  );
};

/**
 * Drawer Outer Edge Vector SVG Overlay
 * Draws true 3D Allen hex head machine bolts down the right bevel border.
 */
export const DrawerSideBezelOverlay: React.FC = () => {
  return (
    <div className="absolute top-0 bottom-0 right-0 w-6 pointer-events-none z-40 flex flex-col justify-between items-center py-4 select-none">
      <TitaniumHexBolt size={13} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
      <TitaniumHexBolt size={13} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] opacity-90" />
      <TitaniumHexBolt size={13} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] opacity-90" />
      <TitaniumHexBolt size={13} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] opacity-90" />
      <TitaniumHexBolt size={13} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] opacity-90" />
      <TitaniumHexBolt size={13} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
    </div>
  );
};

interface MetalTagCardProps {
  children: React.ReactNode;
  className?: string;
  isActive?: boolean;
  isFiltered?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  title?: string;
  statusBarColor?: string;
}

/**
 * 3D Realism Stamped Metal Tag Job Card Component
 * Stamped metallic plate with 3D bevels, chamfered corner rivets, and status light pipe.
 */
export const MetalTagCard: React.FC<MetalTagCardProps> = ({
  children,
  className = "",
  isActive = false,
  isFiltered = false,
  onClick,
  onKeyDown,
  title,
  statusBarColor,
}) => {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
      title={title}
      className={`relative overflow-hidden rounded-xl p-3.5 border transition-all select-none group focus:outline-none ${
        onClick ? "cursor-pointer" : ""
      } ${
        isActive
          ? "bg-gradient-to-r from-[#0d1527] via-[#131d35] to-[#0d1527] border-blue-500/90 shadow-[0_0_16px_rgba(37,99,235,0.45),0_6px_14px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.4)] ring-1 ring-blue-400/50"
          : isFiltered
          ? "bg-gradient-to-r from-[#211406] via-[#2d1b09] to-[#211406] border-amber-500/80 shadow-[0_0_14px_rgba(245,158,11,0.35),0_4px_12px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.3)]"
          : "bg-gradient-to-br from-[#0a0f1d] via-[#070a14] to-[#0a0f1d] hover:from-[#11182c] hover:to-[#0f172a] border-slate-700/80 hover:border-slate-300/80 shadow-[0_4px_12px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.2)]"
      } ${className}`}
    >
      {/* 3D Stamped Outer Chamfer Rim Highlight */}
      <div className="absolute inset-0 border border-white/10 rounded-xl pointer-events-none" />

      {/* Tracker Status Light Rail */}
      {statusBarColor && (
        <span
          className={`absolute left-0 top-0 bottom-0 w-1.5 ${statusBarColor}`}
        />
      )}

      {/* Corner Hex Rivets */}
      <TitaniumHexBolt size={10} className="absolute top-1.5 right-1.5 opacity-60 group-hover:opacity-100 transition-opacity" />
      <TitaniumHexBolt size={10} className="absolute bottom-1.5 right-1.5 opacity-60 group-hover:opacity-100 transition-opacity" />

      <div className={`${statusBarColor ? "pl-2" : ""} pr-3 relative z-10 space-y-2`}>
        {children}
      </div>
    </div>
  );
};
