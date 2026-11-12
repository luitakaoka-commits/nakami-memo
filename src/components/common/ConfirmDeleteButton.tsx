"use client";

import { Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const messageId = useId();

  // 確認は window.confirm と同じ意味（OK なら消す・キャンセルなら何もしない）。見た目だけダイアログの型にそろえる
  function handleClick() {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (window.confirm(message)) void runDelete();
  }

  function handleConfirm() {
    dialogRef.current?.close();
    void runDelete();
  }

  async function runDelete() {
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
      <dialog ref={dialogRef} className="ui-dialog" aria-describedby={messageId}>
        <p id={messageId} className="ui-dialog__message">{message}</p>
        <div className="ui-dialog__actions">
          <button type="button" onClick={() => dialogRef.current?.close()} className="ui-button ui-button--secondary">キャンセル</button>
          <button type="button" onClick={handleConfirm} className="ui-button ui-button--danger-solid">{label}</button>
        </div>
      </dialog>
      {failure && <p role="alert" className="ui-error">{failure}</p>}
    </>
  );
}
