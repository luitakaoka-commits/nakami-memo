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
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className="mt-2 flex items-center gap-4">
        <div className="relative h-24 w-24 overflow-hidden rounded-2xl bg-slate-100">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="選択中の写真" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">No Image</div>
          )}
        </div>
        <input type="file" accept="image/*" onChange={handleChange} className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-700" />
      </div>
    </label>
  );
}
