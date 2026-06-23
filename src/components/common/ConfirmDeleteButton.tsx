"use client";

import { useState } from "react";

export function ConfirmDeleteButton({
  label = "削除",
  message = "本当に削除しますか？",
  onConfirm,
}: {
  label?: string;
  message?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!window.confirm(message)) return;
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
    >
      {loading ? "削除中" : label}
    </button>
  );
}
