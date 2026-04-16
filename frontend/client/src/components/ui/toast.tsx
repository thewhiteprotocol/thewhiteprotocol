import * as React from "react"
import * as ToastPrimitives from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X, CheckCircle, AlertCircle, Info, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-3 p-4 md:max-w-[420px]",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center gap-4 overflow-hidden rounded-2xl bg-[#E0E5EC] p-5 pr-10 shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff] transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "",
        destructive: "border-l-4 border-red-500",
        success: "border-l-4 border-emerald-500",
        loading: "border-l-4 border-blue-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-xl bg-[#E0E5EC] px-4 text-sm font-bold text-slate-600 shadow-[4px_4px_8px_#b8b9be,-4px_-4px_8px_#ffffff] hover:shadow-[2px_2px_4px_#b8b9be,-2px_-2px_4px_#ffffff] active:shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff] transition-all focus:outline-none disabled:pointer-events-none disabled:opacity-50",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-3 top-3 rounded-lg p-1.5 bg-[#E0E5EC] shadow-[2px_2px_4px_#b8b9be,-2px_-2px_4px_#ffffff] text-slate-400 opacity-70 transition-all hover:opacity-100 hover:text-slate-600 active:shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff] focus:outline-none",
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-sm font-bold text-slate-700", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-sm text-slate-500", className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

function ToastIcon({ variant }: { variant?: string | null }) {
  const iconClass = "w-8 h-8 p-1.5 rounded-xl bg-[#E0E5EC] shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff] flex items-center justify-center"

  if (variant === "success") {
    return <div className={iconClass}><CheckCircle className="w-5 h-5 text-emerald-500" /></div>
  }
  if (variant === "destructive") {
    return <div className={iconClass}><AlertCircle className="w-5 h-5 text-red-500" /></div>
  }
  if (variant === "loading") {
    return <div className={iconClass}><Loader2 className="w-5 h-5 text-blue-500 animate-spin" /></div>
  }
  return <div className={iconClass}><Info className="w-5 h-5 text-blue-500" /></div>
}

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
  ToastIcon,
}
