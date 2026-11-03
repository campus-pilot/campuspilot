import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const frameVariants = cva(
  "relative flex flex-col rounded-xl bg-muted/50 p-1",
  {
    variants: {
      variant: {
        default: "border",
        ghost: "bg-transparent",
      },
      spacing: {
        sm: "gap-0.5 p-0.5",
        default: "gap-1 p-1",
        lg: "gap-2 p-2",
      },
      stacked: {
        true: "gap-0 [&>[data-slot=frame-panel]:not(:first-of-type)]:rounded-t-none [&>[data-slot=frame-panel]:not(:first-of-type)]:border-t-0 [&>[data-slot=frame-panel]:not(:last-of-type)]:rounded-b-none",
        false: "",
      },
      dense: {
        true: "gap-0 p-0",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      spacing: "default",
      stacked: false,
      dense: false,
    },
  },
)

/** Copy-owned ReUI Frame primitive for visually related bounded panels. */
function Frame({ className, variant, spacing, stacked, dense, ...props }: React.ComponentProps<"div"> & VariantProps<typeof frameVariants>) {
  return <div data-slot="frame" className={cn(frameVariants({ variant, spacing, stacked, dense }), className)} {...props} />
}

function FramePanel({ className, fit, ...props }: React.ComponentProps<"section"> & { fit?: boolean }) {
  return <section data-slot="frame-panel" className={cn("relative overflow-hidden rounded-lg border bg-card shadow-xs", !fit && "grow", className)} {...props} />
}

function FrameHeader({ className, ...props }: React.ComponentProps<"header">) {
  return <header data-slot="frame-header" className={cn("flex flex-col gap-0.5 px-4 py-3", className)} {...props} />
}

function FrameTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="frame-title" className={cn("text-sm font-semibold", className)} {...props} />
}

function FrameDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="frame-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

function FrameFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return <footer data-slot="frame-footer" className={cn("px-4 py-3", className)} {...props} />
}

export { Frame, FramePanel, FrameHeader, FrameTitle, FrameDescription, FrameFooter, frameVariants }
