"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useId } from "react";

export type SaveProgressStage = "idle" | "saving" | "uploading" | "finalizing" | "success" | "error";

export type SaveProgressState = {
  stage: SaveProgressStage;
  progress?: number;
  message?: string;
};

export const IDLE_SAVE_PROGRESS: SaveProgressState = { stage: "idle", progress: 0 };

export function SaveProgressDialog({
  state,
  hasImage,
  onClose,
}: {
  state: SaveProgressState;
  hasImage: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const detailId = useId();

  if (state.stage === "idle") return null;

  const progress = Math.min(100, Math.max(0, state.progress ?? 0));
  const isError = state.stage === "error";
  const isSuccess = state.stage === "success";
  const isUploading = state.stage === "uploading";
  const title = {
    saving: "保存しています",
    uploading: "画像を登録しています",
    finalizing: "登録を仕上げています",
    success: "保存しました",
    error: "保存できませんでした",
    idle: "",
  }[state.stage];
  const detail = state.message ?? {
    saving: "基本情報を保存中",
    uploading: `${progress}%`,
    finalizing: "画像を反映中",
    success: hasImage ? "画像も登録されました" : "登録が完了しました",
    error: "時間をおいて、もう一度お試しください",
    idle: "",
  }[state.stage];

  return (
    <div className="ui-save-overlay" role="presentation">
      <section
        className="ui-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        aria-live="polite"
      >
        <div className={`ui-save-dialog__icon${isError ? " ui-save-dialog__icon--error" : isSuccess ? " ui-save-dialog__icon--success" : ""}`} aria-hidden="true">
          {isError ? <CircleAlert size={24} /> : isSuccess ? <Check size={25} strokeWidth={2.5} /> : <LoaderCircle className="ui-save-dialog__spinner" size={25} />}
        </div>
        <h2 id={titleId} className="ui-save-dialog__title">{title}</h2>
        <p id={detailId} className="ui-save-dialog__detail">{detail}</p>

        {isUploading && (
          <div
            className="ui-save-progress"
            role="progressbar"
            aria-label="画像のアップロード進捗"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        )}

        {isError && (
          <button type="button" onClick={onClose} className="ui-button ui-button--secondary ui-button--full mt-5">
            閉じる
          </button>
        )}
      </section>
    </div>
  );
}
