"use client";

/** Dialog konfirmasi buat aksi destruktif (delete / archive permanen). */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Hapus",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel} role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-[0_2px_4px_#00000057,0_12px_32px_#00000052]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-1.5 text-xs leading-relaxed text-muted">{description}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text">
            Batal
          </button>
          <button
            onClick={onConfirm}
            className="min-h-11 rounded-[13px] bg-danger px-4 py-2 text-[13px] font-extrabold text-[#0c1500] transition-transform hover:brightness-110 active:scale-[0.98]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}