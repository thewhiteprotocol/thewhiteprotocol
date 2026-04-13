import React from 'react';
import { cn } from "@/lib/utils";

interface GlowCardProps {
  children: React.ReactNode;
  className?: string;
  gradientFrom?: string;
  gradientTo?: string;
  glowIntensity?: 'low' | 'medium' | 'high';
  animated?: boolean;
}

export function GlowCard({ 
  children, 
  className,
  gradientFrom = '#a855f7',
  gradientTo = '#06b6d4',
  glowIntensity = 'medium',
  animated = true,
}: GlowCardProps) {
  const intensityClasses = {
    low: 'opacity-20 group-hover:opacity-30',
    medium: 'opacity-30 group-hover:opacity-50',
    high: 'opacity-50 group-hover:opacity-70',
  };

  return (
    <div 
      className={cn("relative group", className)}
      style={{ 
        '--gradient-from': gradientFrom, 
        '--gradient-to': gradientTo 
      } as React.CSSProperties}
    >
      {/* Animated glow background - NO POINTER EVENTS */}
      <div 
        className={cn(
          "absolute -inset-[1px] rounded-2xl blur-xl transition-all duration-700 pointer-events-none",
          "bg-gradient-to-r from-[var(--gradient-from)] via-primary to-[var(--gradient-to)]",
          intensityClasses[glowIntensity],
          animated && "animate-pulse"
        )}
      />
      
      {/* Animated border - NO POINTER EVENTS */}
      <div 
        className={cn(
          "absolute inset-0 rounded-2xl p-[1px] overflow-hidden pointer-events-none",
          "bg-gradient-to-r from-[var(--gradient-from)] via-transparent to-[var(--gradient-to)]",
          "opacity-50 group-hover:opacity-100 transition-opacity duration-500"
        )}
      >
        {animated && (
          <div 
            className="absolute inset-[-100%] animate-[spin_8s_linear_infinite]"
            style={{
              background: `conic-gradient(from 0deg, transparent, ${gradientFrom}, transparent, ${gradientTo}, transparent)`
            }}
          />
        )}
        <div className="h-full w-full rounded-[15px] bg-background" />
      </div>
      
      {/* Content - CLICKABLE with z-index */}
      <div className="relative z-10 rounded-2xl bg-card/95 backdrop-blur-sm border border-border/50 overflow-hidden">
        {/* Inner shine effect */}
        <div 
          className="absolute inset-0 opacity-5 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at top, ${gradientFrom}40, transparent 50%)`
          }}
        />
        {children}
      </div>
    </div>
  );
}

// Simpler version without animation for better performance
export function GlowCardSimple({ 
  children, 
  className,
  gradientFrom = '#a855f7',
  gradientTo = '#06b6d4',
}: Omit<GlowCardProps, 'glowIntensity' | 'animated'>) {
  return (
    <div 
      className={cn("relative group", className)}
      style={{ 
        '--gradient-from': gradientFrom, 
        '--gradient-to': gradientTo 
      } as React.CSSProperties}
    >
      {/* Glow on hover - NO POINTER EVENTS */}
      <div 
        className="absolute -inset-0.5 rounded-2xl opacity-0 group-hover:opacity-50 blur-lg transition-all duration-500 pointer-events-none
                   bg-gradient-to-r from-[var(--gradient-from)] to-[var(--gradient-to)]"
      />
      
      {/* Border - NO POINTER EVENTS */}
      <div 
        className="absolute inset-0 rounded-2xl p-[1px] opacity-30 group-hover:opacity-60 transition-opacity duration-300 pointer-events-none
                   bg-gradient-to-r from-[var(--gradient-from)] to-[var(--gradient-to)]"
      >
        <div className="h-full w-full rounded-[15px] bg-background" />
      </div>
      
      {/* Content - CLICKABLE */}
      <div className="relative z-10 rounded-2xl bg-card border border-border/30">
        {children}
      </div>
    </div>
  );
}

export default GlowCard;
