import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "./client";

const ONE_IMAGE_PATH = "image";

export type UploadProgressHandler = (progress: number) => void;

async function uploadImage(path: string, file: File, onProgress?: UploadProgressHandler): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }

  const imageRef = ref(storage, path);
  const uploadTask = uploadBytesResumable(imageRef, file, { contentType: file.type });

  await new Promise<void>((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = snapshot.totalBytes > 0
          ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          : 0;
        onProgress?.(progress);
      },
      reject,
      resolve,
    );
  });

  onProgress?.(100);
  return getDownloadURL(imageRef);
}

export function uploadLocationImage(userId: string, locationId: string, file: File, onProgress?: UploadProgressHandler) {
  return uploadImage(`users/${userId}/locations/${locationId}/${ONE_IMAGE_PATH}`, file, onProgress);
}

export function uploadItemImage(userId: string, itemId: string, file: File, onProgress?: UploadProgressHandler) {
  return uploadImage(`users/${userId}/items/${itemId}/${ONE_IMAGE_PATH}`, file, onProgress);
}
