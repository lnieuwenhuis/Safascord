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
    <div className="fixed inset-0 z-[200] flex">
      <div 
        className="fixed inset-0 bg-slate-950/72 backdrop-blur-[3px] transition-opacity" 
        onClick={() => onOpenChange(false)}
      />
      <div 
        className={cn(
          "relative z-[210] flex h-full w-[82vw] max-w-[420px] flex-col border-cyan-300/20 bg-slate-950/92 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-in-out",
          side === "left" ? "mr-auto border-r" : "ml-auto border-l",
        )}
      >
        <div className="absolute right-3 top-3 z-10">
          <button className="btn btn-ghost btn-sm btn-square" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
