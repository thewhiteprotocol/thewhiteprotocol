import React, { forwardRef, useState } from 'react';
import { cn } from "@/lib/utils";

interface GlowInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ReactNode;
  suffix?: React.ReactNode;
  error?: string;
  gradientFrom?: string;
  gradientTo?: string;
}

export const GlowInput = forwardRef<HTMLInputElement, GlowInputProps>(
  ({ 
    className, 
    label, 
    icon, 
    suffix, 
    error,
    gradientFrom = '#a855f7',
    gradientTo = '#06b6d4',
    ...props 
  }, ref) => {
    const [isFocused, setIsFocused] = useState(false);

    return (
      <div className="space-y-2">
        {label && (
          <label className="text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <div 
          className="relative group"
          style={{ 
            '--gradient-from': gradientFrom, 
            '--gradient-to': gradientTo 
          } as React.CSSProperties}
        >
          {/* Glow effect */}
          <div 
            className={cn(
              "absolute -inset-0.5 rounded-xl opacity-0 blur-sm transition-all duration-500",
              "bg-gradient-to-r from-[var(--gradient-from)] to-[var(--gradient-to)]",
              isFocused && "opacity-70",
              "group-hover:opacity-40"
            )}
          />
          
          {/* Border gradient */}
          <div 
            className={cn(
              "absolute inset-0 rounded-xl opacity-0 transition-all duration-300",
              "bg-gradient-to-r from-[var(--gradient-from)] to-[var(--gradient-to)] p-[1px]",
              isFocused && "opacity-100",
              "group-hover:opacity-50"
            )}
          >
            <div className="h-full w-full rounded-[11px] bg-background" />
          </div>
          
          {/* Input container */}
          <div 
            className={cn(
              "relative flex items-center gap-3 rounded-xl border bg-background/80 backdrop-blur-sm",
              "transition-all duration-300",
              isFocused ? "border-transparent" : "border-border",
              error && "border-destructive"
            )}
          >
            {icon && (
              <span className="pl-4 text-muted-foreground">
                {icon}
              </span>
            )}
            <input
              ref={ref}
              className={cn(
                "flex-1 bg-transparent py-3 text-foreground placeholder:text-muted-foreground",
                "focus:outline-none",
                icon ? "pr-4" : "px-4",
                suffix && "pr-0",
                className
              )}
              onFocus={(e) => {
                setIsFocused(true);
                props.onFocus?.(e);
              }}
              onBlur={(e) => {
                setIsFocused(false);
                props.onBlur?.(e);
              }}
              {...props}
            />
            {suffix && (
              <span className="pr-4 text-muted-foreground font-medium">
                {suffix}
              </span>
            )}
          </div>
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>
    );
  }
);

GlowInput.displayName = 'GlowInput';

export default GlowInput;
