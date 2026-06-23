import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./client";

const ONE_IMAGE_PATH = "image";

async function uploadImage(path: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }

  const imageRef = ref(storage, path);
  await uploadBytes(imageRef, file, { contentType: file.type });
  return getDownloadURL(imageRef);
}

export function uploadLocationImage(userId: string, locationId: string, file: File) {
  return uploadImage(`users/${userId}/locations/${locationId}/${ONE_IMAGE_PATH}`, file);
}

export function uploadItemImage(userId: string, itemId: string, file: File) {
  return uploadImage(`users/${userId}/items/${itemId}/${ONE_IMAGE_PATH}`, file);
}
