import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"

export default function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  cancelText = "Cancel",
}: {
  open: boolean
  title: string
  description?: string
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
  cancelText?: string
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm supports-[backdrop-filter]:bg-black/50 p-4" onClick={onCancel}>
      <div className="w-[420px] rounded-2xl border border-cyan-300/20 bg-slate-950 p-4 shadow-xl text-slate-100" onClick={(e) => e.stopPropagation()}>
        <div className="text-lg font-semibold">{title}</div>
        {description ? <div className="mt-2 text-sm text-slate-300/72">{description}</div> : null}
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>{cancelText}</Button>
          <Button variant="brand" onClick={onConfirm}>{confirmText}</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
