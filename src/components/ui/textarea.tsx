import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, style, ...props }: React.ComponentProps<"textarea">) {
  // field-sizing-content ignores `rows`, so honour it as the starting height instead.
  const rows = typeof props.rows === "number" && props.rows > 1 ? props.rows : null
  return (
    <textarea
      data-slot="textarea"
      style={rows ? { minHeight: `calc(${rows}lh + 1rem + 2px)`, ...style } : style}
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
