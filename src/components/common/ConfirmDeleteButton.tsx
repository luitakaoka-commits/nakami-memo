"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

export function ConfirmDeleteButton({
  label = "削除",
  message = "本当に削除しますか？",
  onConfirm,
  onError,
}: {
  label?: string;
  message?: string;
  onConfirm: () => Promise<void> | void;
  /** 親側にエラー表示欄がある場合に渡す。渡さなければボタンの下に表示する。 */
  onError?: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");

  async function handleClick() {
    if (!window.confirm(message)) return;
    setFailure("");
    setLoading(true);
    try {
      await onConfirm();
    } catch (err) {
      // onConfirm の rejection を握りつぶすと「押しても何も起きない」ように見えてしまう。
      const text = err instanceof Error ? err.message : "削除できませんでした。";
      if (onError) onError(text);
      else setFailure(text);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={loading} className="ui-button ui-button--danger" title={label}>
        <Trash2 size={15} strokeWidth={1.9} />
        <span>{loading ? "削除中" : label}</span>
      </button>
      {failure && <p role="alert" className="ui-error">{failure}</p>}
    </>
  );
}
