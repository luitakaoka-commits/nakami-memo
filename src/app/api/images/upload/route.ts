import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const BUCKET_NAME = "nakami-memo-images";
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_COLLECTIONS = new Set(["items", "locations"]);

type FirebaseLookupResponse = {
  users?: Array<{ localId?: string }>;
};

async function getFirebaseUserId(request: Request): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authorization = request.headers.get("authorization");
  const idToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!apiKey || !idToken) throw new Error("ログイン情報を確認できませんでした。");

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("ログインの有効期限が切れています。再ログインしてください。");

  const data = (await response.json()) as FirebaseLookupResponse;
  const userId = data.users?.[0]?.localId;
  if (!userId) throw new Error("ユーザーを確認できませんでした。");
  return userId;
}

function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new Error("画像ストレージが接続されていません。");

  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function ensureImageBucket(supabase: SupabaseClient) {
  const { data: bucket, error } = await supabase.storage.getBucket(BUCKET_NAME);
  const options = {
    public: true,
    fileSizeLimit: MAX_IMAGE_SIZE_BYTES,
    allowedMimeTypes: ALLOWED_IMAGE_TYPES,
  };

  if (!bucket) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, options);
    if (createError && !createError.message.toLowerCase().includes("already exists")) throw createError;
    return;
  }

  if (error) throw error;
  if (!bucket.public) {
    const { error: updateError } = await supabase.storage.updateBucket(BUCKET_NAME, options);
    if (updateError) throw updateError;
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getFirebaseUserId(request);
    const formData = await request.formData();
    const file = formData.get("file");
    const collection = formData.get("collection");
    const recordId = formData.get("recordId");

    if (!(file instanceof File)) throw new Error("画像を選んでください。");
    if (typeof collection !== "string" || !ALLOWED_COLLECTIONS.has(collection)) {
      throw new Error("保存先が正しくありません。");
    }
    if (typeof recordId !== "string" || !recordId.trim()) throw new Error("保存先が正しくありません。");
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) throw new Error("対応していない画像形式です。");
    if (file.size >= MAX_IMAGE_SIZE_BYTES) throw new Error("5 MB未満の画像を選んでください。");

    const supabase = getSupabaseClient();
    await ensureImageBucket(supabase);

    const path = `users/${userId}/${collection}/${recordId}/image`;
    const { error: uploadError } = await supabase.storage.from(BUCKET_NAME).upload(path, file, {
      cacheControl: "60",
      contentType: file.type,
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
    return NextResponse.json({ url: `${data.publicUrl}?v=${Date.now()}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "画像のアップロードに失敗しました。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
