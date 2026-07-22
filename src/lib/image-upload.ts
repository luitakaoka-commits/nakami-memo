"use client";

import type { User } from "firebase/auth";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export type UploadProgressHandler = (progress: number) => void;

type UploadResponse = {
  url?: string;
  error?: string;
};

async function uploadImage(
  user: User,
  collection: "items" | "locations",
  recordId: string,
  file: File,
  onProgress?: UploadProgressHandler,
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("JPEG・PNG・WebP・GIF形式の画像を選んでください。");
  }
  if (file.size >= MAX_IMAGE_SIZE_BYTES) {
    throw new Error("5 MB未満の画像を選んでください。");
  }

  const idToken = await user.getIdToken();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("collection", collection);
  formData.append("recordId", recordId);

  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/images/upload");
    request.setRequestHeader("Authorization", `Bearer ${idToken}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 95));
      }
    };
    request.onerror = () => reject(new Error("画像をアップロードできませんでした。"));
    request.onload = () => {
      let response: UploadResponse = {};
      try {
        response = JSON.parse(request.responseText) as UploadResponse;
      } catch {
        reject(new Error("画像をアップロードできませんでした。"));
        return;
      }

      if (request.status < 200 || request.status >= 300 || !response.url) {
        reject(new Error(response.error || "画像をアップロードできませんでした。"));
        return;
      }

      onProgress?.(100);
      resolve(response.url);
    };
    request.send(formData);
  });
}

export function uploadLocationImage(user: User, locationId: string, file: File, onProgress?: UploadProgressHandler) {
  return uploadImage(user, "locations", locationId, file, onProgress);
}

export function uploadItemImage(user: User, itemId: string, file: File, onProgress?: UploadProgressHandler) {
  return uploadImage(user, "items", itemId, file, onProgress);
}
