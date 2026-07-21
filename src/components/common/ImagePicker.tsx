"use client";

import { useState } from "react";

export function ImagePicker({
  imageUrl,
  onFileSelect,
  label = "写真",
}: {
  imageUrl?: string;
  onFileSelect: (file: File) => void;
  label?: string;
}) {
  const [preview, setPreview] = useState<string | undefined>(imageUrl);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    onFileSelect(file);
  }

  return (
    <label className="ui-image-picker">
      {label}
      <div className="ui-image-picker__row">
        <div className="ui-image-picker__preview">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="選択中の写真" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[var(--ink-muted)]">写真なし</div>
          )}
        </div>
        <input type="file" accept="image/*" onChange={handleChange} aria-label={label} />
      </div>
    </label>
  );
}

