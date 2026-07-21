"use client";

import { Trash2 } from "lucide-react";
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
    <button type="button" onClick={handleClick} disabled={loading} className="ui-button ui-button--danger" title={label}>
      <Trash2 size={15} strokeWidth={1.9} />
      <span>{loading ? "削除中" : label}</span>
    </button>
  );
}

