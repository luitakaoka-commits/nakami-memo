import {
  Timestamp,
  addDoc,
  deleteDoc,
  deleteField,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import type { AreaInput } from "@/lib/types/area";
import type { ItemInput } from "@/lib/types/item";
import type { LocationInput } from "@/lib/types/location";
import { createPublicToken } from "@/lib/utils/qr";
import {
  areaDoc,
  areasCollection,
  getItem,
  getLocation,
  itemDoc,
  itemsCollection,
  locationDoc,
  locationsCollection,
  usersDoc,
} from "./refs";
import { deletePublicLocation, syncPublicByLocationIfNeeded, syncPublicLocation } from "./public-location";

export {
  areaDoc,
  areasCollection,
  areasQuery,
  getArea,
  getItem,
  getLocation,
  itemDoc,
  itemsCollection,
  itemsQuery,
  locationDoc,
  locationsCollection,
  locationsQuery,
  publicLocationDoc,
  snapToArea,
  snapToItem,
  snapToLocation,
} from "./refs";
export { syncPublicLocation } from "./public-location";

type WriteMode = "create" | "update";

/**
 * 作成用と更新用でペイロードの意味が違うため、モードで整形を切り替える。
 * - create: undefined のキーは落とす（フィールドを作らない）
 * - update: undefined のキーは deleteField() にする（フィールドを明示的に消す）
 *   updateDoc で undefined を落としてしまうと「そのフィールドを触らない」になり、
 *   画面で空にしても古い値が残ってしまう。
 * null を明示的に渡したいフィールド（expirationDate など）はそのまま null を書き込む。
 */
function buildPayload(value: Record<string, unknown>, mode: WriteMode): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (entry !== undefined) {
      payload[key] = entry;
      return;
    }
    if (mode === "update") payload[key] = deleteField();
  });
  return payload;
}

function withTimestamps(value: Record<string, unknown>, mode: WriteMode): Record<string, unknown> {
  return {
    ...value,
    ...(mode === "create" ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  };
}

function areaPayload(input: AreaInput, mode: WriteMode) {
  return withTimestamps(
    buildPayload(
      {
        name: input.name.trim(),
        sortOrder: input.sortOrder ?? undefined,
      },
      mode,
    ),
    mode,
  );
}

function locationPayload(input: LocationInput, mode: WriteMode, isPublic: boolean) {
  return withTimestamps(
    buildPayload(
      {
        areaId: input.areaId,
        name: input.name.trim(),
        type: input.type?.trim() || undefined,
        memo: input.memo?.trim() || undefined,
        labelName: input.labelName?.trim() || undefined,
        sortOrder: input.sortOrder ?? undefined,
        isPublic,
      },
      mode,
    ),
    mode,
  );
}

function itemPayload(input: ItemInput, mode: WriteMode) {
  return withTimestamps(
    buildPayload(
      {
        locationId: input.locationId,
        name: input.name.trim(),
        quantity: Number(input.quantity),
        unit: input.unit?.trim() || undefined,
        statusMemo: input.statusMemo?.trim() || undefined,
        category: input.category?.trim() || undefined,
        expirationDate: input.expirationDate ? Timestamp.fromDate(input.expirationDate) : null,
        expirationType: input.expirationType?.trim() || undefined,
        notifyDaysBefore: input.notifyDaysBefore ?? null,
        memo: input.memo?.trim() || undefined,
        lowStockThreshold: input.lowStockThreshold ?? null,
      },
      mode,
    ),
    mode,
  );
}

export async function ensureUserDocument(userId: string, displayName?: string | null, email?: string | null) {
  await setDoc(
    usersDoc(userId),
    {
      displayName: displayName ?? null,
      email: email ?? null,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function createArea(userId: string, input: AreaInput) {
  return addDoc(areasCollection(userId), areaPayload(input, "create"));
}

export async function updateArea(userId: string, areaId: string, input: AreaInput) {
  await updateDoc(areaDoc(userId, areaId), areaPayload(input, "update"));
}

export async function deleteArea(userId: string, areaId: string) {
  const locationSnapshot = await getDocs(query(locationsCollection(userId), where("areaId", "==", areaId), limit(1)));
  if (!locationSnapshot.empty) {
    throw new Error("このエリアを使っている保管場所があります。先に保管場所を移動・削除してください。");
  }
  await deleteDoc(areaDoc(userId, areaId));
}

export async function createLocation(userId: string, input: LocationInput) {
  const newLocation = await addDoc(locationsCollection(userId), locationPayload(input, "create", false));

  if (input.isPublic) {
    await setLocationPublic(userId, newLocation.id, true);
  }

  return newLocation;
}

export async function updateLocation(userId: string, locationId: string, input: LocationInput) {
  const current = await getLocation(userId, locationId);
  const isPublic = input.isPublic ?? current?.isPublic ?? false;
  await updateDoc(locationDoc(userId, locationId), locationPayload(input, "update", isPublic));

  if ((input.isPublic ?? false) !== (current?.isPublic ?? false)) {
    await setLocationPublic(userId, locationId, input.isPublic ?? false);
  } else if (isPublic) {
    await syncPublicLocation(userId, locationId);
  }
}

export async function updateLocationImageUrl(userId: string, locationId: string, imageUrl: string) {
  await updateDoc(locationDoc(userId, locationId), {
    imageUrl,
    updatedAt: serverTimestamp(),
  });
}

export async function setLocationPublic(userId: string, locationId: string, isPublic: boolean) {
  const location = await getLocation(userId, locationId);
  if (!location) throw new Error("保管場所が見つかりません。");

  let publicToken = location.publicToken;
  if (isPublic && !publicToken) {
    publicToken = createPublicToken();
  }

  await updateDoc(
    locationDoc(userId, locationId),
    buildPayload(
      {
        isPublic,
        publicToken: publicToken ?? undefined,
        updatedAt: serverTimestamp(),
      },
      // 非公開化しても publicToken は消さない（再公開時に同じURLを保つ）。
      "create",
    ),
  );

  if (isPublic && publicToken) {
    await syncPublicLocation(userId, locationId, publicToken);
  } else if (publicToken) {
    await deletePublicLocation(publicToken);
  }
}

export async function deleteLocation(userId: string, locationId: string) {
  const itemSnapshot = await getDocs(query(itemsCollection(userId), where("locationId", "==", locationId), limit(1)));
  if (!itemSnapshot.empty) {
    throw new Error("中身がある保管場所は削除できません。先にアイテムを移動または削除してください。");
  }

  const location = await getLocation(userId, locationId);
  if (location?.publicToken) {
    await deletePublicLocation(location.publicToken);
  }
  await deleteDoc(locationDoc(userId, locationId));
}

export async function createItem(userId: string, input: ItemInput) {
  const newItem = await addDoc(itemsCollection(userId), itemPayload(input, "create"));

  await syncPublicByLocationIfNeeded(userId, input.locationId);
  return newItem;
}

export async function updateItem(userId: string, itemId: string, input: ItemInput) {
  const current = await getItem(userId, itemId);
  if (!current) throw new Error("アイテムが見つかりません。");

  await updateDoc(itemDoc(userId, itemId), itemPayload(input, "update"));

  await syncPublicByLocationIfNeeded(userId, current.locationId);
  if (current.locationId !== input.locationId) {
    await syncPublicByLocationIfNeeded(userId, input.locationId);
  }
}

export async function updateItemImageUrl(userId: string, itemId: string, imageUrl: string) {
  const item = await getItem(userId, itemId);
  await updateDoc(itemDoc(userId, itemId), {
    imageUrl,
    updatedAt: serverTimestamp(),
  });
  if (item) await syncPublicByLocationIfNeeded(userId, item.locationId);
}

export async function deleteItem(userId: string, itemId: string) {
  const item = await getItem(userId, itemId);
  await deleteDoc(itemDoc(userId, itemId));
  if (item) await syncPublicByLocationIfNeeded(userId, item.locationId);
}
