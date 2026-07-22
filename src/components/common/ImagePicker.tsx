"use client";

import { Check, ImagePlus } from "lucide-react";
import { useEffect, useState } from "react";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export function ImagePicker({
  imageUrl,
  onFileSelect,
  label = "写真",
  disabled = false,
}: {
  imageUrl?: string;
  onFileSelect: (file: File | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<string | undefined>(imageUrl);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectionError, setSelectionError] = useState("");

  useEffect(() => {
    setPreview(imageUrl);
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSelectionError("画像ファイルを選んでください");
      setSelectedFile(null);
      setPreview(imageUrl);
      onFileSelect(null);
      event.target.value = "";
      return;
    }
    if (file.size >= MAX_IMAGE_SIZE_BYTES) {
      setSelectionError("5 MB未満の画像を選んでください");
      setSelectedFile(null);
      setPreview(imageUrl);
      onFileSelect(null);
      event.target.value = "";
      return;
    }
    setSelectionError("");
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    onFileSelect(file);
  }

  const fileSize = selectedFile
    ? selectedFile.size < 1024 * 1024
      ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB`
      : `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`
    : "";

  return (
    <label className="ui-image-picker">
      {label}
      <div className="ui-image-picker__row">
        <div className="ui-image-picker__preview">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="選択中の写真" className="h-full w-full object-cover" />
          ) : (
            <div className="ui-image-picker__empty"><ImagePlus size={22} strokeWidth={1.8} /><span>写真なし</span></div>
          )}
        </div>
        <div className="ui-image-picker__control">
          <input className="ui-image-picker__input" type="file" accept="image/*" onChange={handleChange} aria-label={label} disabled={disabled} />
          <span className="ui-image-picker__button" aria-hidden="true"><ImagePlus size={16} strokeWidth={2} />写真を選ぶ</span>
          {selectedFile && (
            <p className="ui-image-picker__selection" aria-live="polite">
              <Check size={15} strokeWidth={2.5} aria-hidden="true" />
              <span>{selectedFile.name}</span>
              <small>{fileSize}</small>
            </p>
          )}
          {selectionError && <p role="alert" className="ui-image-picker__error">{selectionError}</p>}
        </div>
      </div>
    </label>
  );
}
