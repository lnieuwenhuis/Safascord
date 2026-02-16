import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "btn inline-flex items-center justify-center whitespace-nowrap text-sm font-semibold normal-case tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "btn-primary shadow-sm",
        destructive: "btn-error shadow-sm",
        outline: "btn-outline border-base-300 bg-base-100/80",
        secondary: "btn-secondary shadow-sm",
        ghost: "btn-ghost shadow-none",
        link: "btn-link px-0 no-underline hover:underline",
        brand: "bg-slate-900 text-white hover:bg-slate-800 border border-slate-900",
      },
      size: {
        default: "h-10 min-h-10 px-4",
        sm: "h-9 min-h-9 px-3 text-xs",
        lg: "h-11 min-h-11 px-6",
        icon: "btn-square h-10 min-h-10 w-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

 
