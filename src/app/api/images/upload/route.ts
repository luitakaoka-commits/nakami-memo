import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * 3アプリ共通の画像アップロードAPI。
 *
 * Supabase の service_role キーはサーバー側にしか置けないため、画像の保存は必ずここを通す。
 * 同一オリジンに同居している /money /recipe からも呼べる。
 *
 * つくりおきノートが Firebase Storage ではなくここを使う理由:
 * Cloud Storage for Firebase は2024年9月以降、バケットの作成に Blaze プラン
 * （クレジットカード登録）が必須になった。recipe-a18e1 も nakami-memo も Spark のままなので、
 * 画像は Supabase Storage に寄せている。
 */

const BUCKET_NAME = "nakami-memo-images";
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// FirestoreのドキュメントIDをそのままストレージキーに使うため、形式を厳密に絞る。
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 呼び出し元アプリの定義。
 *
 * apiKey は Firebase の「ウェブAPIキー」で、クライアントに配られる公開値。
 * identitytoolkit でIDトークンを検証するために、トークンを発行したプロジェクトのキーが要る。
 * 環境変数で上書きできるが、設定漏れで画像が保存できなくなるのを避けるため既定値を持たせている。
 *
 * uid は Firebaseプロジェクトごとに別々に発行されるため、保存パスもアプリ単位で分ける。
 */
type AppKey = "nakami" | "recipe";

type AppConfig = {
  apiKey: string | undefined;
  collections: ReadonlySet<string>;
  /** ストレージキーの組み立て。アプリをまたいで衝突しない形にする。 */
  buildPath: (userId: string, collection: string, recordId: string) => string;
};

const APPS: Record<AppKey, AppConfig> = {
  // なかみメモ（このNext.jsアプリ本体）。既存の保存パスは変えない。
  nakami: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    collections: new Set(["items", "locations"]),
    buildPath: (userId, collection, recordId) => `users/${userId}/${collection}/${recordId}/image`,
  },
  // つくりおきノート（public/recipe/、Firebaseプロジェクト recipe-a18e1）。
  recipe: {
    apiKey:
      process.env.NEXT_PUBLIC_RECIPE_FIREBASE_API_KEY ||
      "AIzaSyClrHXJL7HDrEfCU0chH2FUuXCu54aQcQ0",
    collections: new Set(["recipes"]),
    buildPath: (userId, collection, recordId) => `recipe/${userId}/${collection}/${recordId}/image`,
  },
};

/** ステータスコードを持たせた、ユーザーに見せてよいエラー。 */
class UploadError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

type FirebaseLookupResponse = {
  users?: Array<{ localId?: string }>;
};

function resolveApp(value: FormDataEntryValue | string | null): AppConfig {
  // 未指定は、この API を最初から使っている なかみメモ とみなす（後方互換）。
  const key = typeof value === "string" && value ? value : "nakami";
  if (!Object.prototype.hasOwnProperty.call(APPS, key)) {
    throw new UploadError("保存先が正しくありません。", 400);
  }
  return APPS[key as AppKey];
}

async function getFirebaseUserId(request: Request, app: AppConfig): Promise<string> {
  const authorization = request.headers.get("authorization");
  const idToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!app.apiKey) throw new UploadError("画像アップロードが設定されていません。", 500);
  if (!idToken) throw new UploadError("ログイン情報を確認できませんでした。", 401);

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${app.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new UploadError("ログインの有効期限が切れています。再ログインしてください。", 401);

  const data = (await response.json()) as FirebaseLookupResponse;
  const userId = data.users?.[0]?.localId;
  if (!userId) throw new UploadError("ユーザーを確認できませんでした。", 401);
  return userId;
}

function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new UploadError("画像ストレージが接続されていません。", 500);

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

/** collection / recordId を検証して、保存先のストレージキーを返す。 */
function resolveStoragePath(
  app: AppConfig,
  userId: string,
  collection: FormDataEntryValue | string | null,
  recordId: FormDataEntryValue | string | null,
): string {
  if (typeof collection !== "string" || !app.collections.has(collection)) {
    throw new UploadError("保存先が正しくありません。", 400);
  }
  if (typeof recordId !== "string" || !RECORD_ID_PATTERN.test(recordId)) {
    throw new UploadError("保存先が正しくありません。", 400);
  }
  return app.buildPath(userId, collection, recordId);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const app = resolveApp(formData.get("app"));
    const userId = await getFirebaseUserId(request, app);

    const file = formData.get("file");
    if (!(file instanceof File)) throw new UploadError("画像を選んでください。", 400);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) throw new UploadError("対応していない画像形式です。", 400);
    if (file.size >= MAX_IMAGE_SIZE_BYTES) throw new UploadError("5 MB未満の画像を選んでください。", 400);

    const path = resolveStoragePath(app, userId, formData.get("collection"), formData.get("recordId"));

    const supabase = getSupabaseClient();
    await ensureImageBucket(supabase);

    const { error: uploadError } = await supabase.storage.from(BUCKET_NAME).upload(path, file, {
      cacheControl: "60",
      contentType: file.type,
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
    return NextResponse.json({ url: `${data.publicUrl}?v=${Date.now()}` });
  } catch (error) {
    // 詳細はサーバーログにだけ残す。Supabase SDK の内部エラー文をそのまま返さない。
    console.error("[api/images/upload] 画像のアップロードに失敗しました。", error);

    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "画像のアップロードに失敗しました。" }, { status: 500 });
  }
}

/**
 * 画像の削除。レコードを消したときに公開バケットへ孤児ファイルが残り続けるのを防ぐ。
 * 自分のuid配下のキーしか組み立てられないので、他人の画像は消せない。
 */
export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { app?: string; collection?: string; recordId?: string }
      | null;
    if (!body) throw new UploadError("リクエストの形式が正しくありません。", 400);

    const app = resolveApp(body.app ?? null);
    const userId = await getFirebaseUserId(request, app);
    const path = resolveStoragePath(app, userId, body.collection ?? null, body.recordId ?? null);

    const supabase = getSupabaseClient();
    const { error: removeError } = await supabase.storage.from(BUCKET_NAME).remove([path]);
    if (removeError) throw removeError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/images/upload] 画像の削除に失敗しました。", error);

    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "画像の削除に失敗しました。" }, { status: 500 });
  }
}
