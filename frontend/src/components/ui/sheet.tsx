import * as React from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  side?: "left" | "right"
}

export function Sheet({ open, onOpenChange, children, side = "left" }: SheetProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div 
        className="fixed inset-0 bg-black/50 transition-opacity" 
        onClick={() => onOpenChange(false)}
      />
      <div 
        className={cn(
          "relative z-50 flex h-full w-3/4 max-w-sm flex-col bg-background shadow-xl transition-transform duration-300 ease-in-out sm:w-[350px]",
          side === "left" ? "mr-auto border-r" : "ml-auto border-l",
          // Animation classes could be added here if we had AnimatePresence or similar, 
          // but for now simple rendering is fine or we can add CSS animations.
        )}
      >
        <div className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
          <button onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
