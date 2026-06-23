import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { Area, AreaInput } from "@/lib/types/area";
import type { Item, ItemInput, PublicItem } from "@/lib/types/item";
import type { Location, LocationInput } from "@/lib/types/location";
import { createPublicToken } from "@/lib/utils/qr";
import { db } from "./client";

const cleanObject = <T extends Record<string, unknown>>(value: T): T => {
  const copy = { ...value };
  Object.keys(copy).forEach((key) => {
    if (copy[key] === undefined) delete copy[key];
  });
  return copy;
};

const usersDoc = (userId: string) => doc(db, "users", userId);
export const areasCollection = (userId: string) => collection(db, "users", userId, "areas");
export const locationsCollection = (userId: string) => collection(db, "users", userId, "locations");
export const itemsCollection = (userId: string) => collection(db, "users", userId, "items");
export const publicLocationDoc = (publicToken: string) => doc(db, "publicLocations", publicToken);

export function areaDoc(userId: string, areaId: string) {
  return doc(db, "users", userId, "areas", areaId);
}

export function locationDoc(userId: string, locationId: string) {
  return doc(db, "users", userId, "locations", locationId);
}

export function itemDoc(userId: string, itemId: string) {
  return doc(db, "users", userId, "items", itemId);
}

function snapToArea(snapshot: QueryDocumentSnapshot<DocumentData>): Area {
  return { id: snapshot.id, ...snapshot.data() } as Area;
}

function snapToLocation(snapshot: QueryDocumentSnapshot<DocumentData>): Location {
  return { id: snapshot.id, isPublic: false, ...snapshot.data() } as Location;
}

function snapToItem(snapshot: QueryDocumentSnapshot<DocumentData>): Item {
  return { id: snapshot.id, ...snapshot.data() } as Item;
}

export { snapToArea, snapToLocation, snapToItem };

export function areasQuery(userId: string) {
  return query(areasCollection(userId), orderBy("name"));
}

export function locationsQuery(userId: string) {
  return query(locationsCollection(userId), orderBy("name"));
}

export function itemsQuery(userId: string, locationId?: string) {
  if (locationId) {
    return query(itemsCollection(userId), where("locationId", "==", locationId));
  }
  return query(itemsCollection(userId), orderBy("name"));
}

export async function ensureUserDocument(userId: string, displayName?: string | null, email?: string | null) {
  await setDoc(
    usersDoc(userId),
    cleanObject({
      displayName: displayName ?? null,
      email: email ?? null,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
    { merge: true },
  );
}

export async function createArea(userId: string, input: AreaInput) {
  return addDoc(
    areasCollection(userId),
    cleanObject({
      name: input.name.trim(),
      sortOrder: input.sortOrder ?? undefined,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
}

export async function updateArea(userId: string, areaId: string, input: AreaInput) {
  await updateDoc(
    areaDoc(userId, areaId),
    cleanObject({
      name: input.name.trim(),
      sortOrder: input.sortOrder ?? undefined,
      updatedAt: serverTimestamp(),
    }),
  );
}

export async function deleteArea(userId: string, areaId: string) {
  const locationSnapshot = await getDocs(query(locationsCollection(userId), where("areaId", "==", areaId), limit(1)));
  if (!locationSnapshot.empty) {
    throw new Error("このエリアを使っている保管場所があります。先に保管場所を移動・削除してください。");
  }
  await deleteDoc(areaDoc(userId, areaId));
}

export async function createLocation(userId: string, input: LocationInput) {
  const newLocation = await addDoc(
    locationsCollection(userId),
    cleanObject({
      areaId: input.areaId,
      name: input.name.trim(),
      type: input.type?.trim() || undefined,
      memo: input.memo?.trim() || undefined,
      labelName: input.labelName?.trim() || undefined,
      sortOrder: input.sortOrder ?? undefined,
      isPublic: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );

  if (input.isPublic) {
    await setLocationPublic(userId, newLocation.id, true);
  }

  return newLocation;
}

export async function updateLocation(userId: string, locationId: string, input: LocationInput) {
  const current = await getLocation(userId, locationId);
  await updateDoc(
    locationDoc(userId, locationId),
    cleanObject({
      areaId: input.areaId,
      name: input.name.trim(),
      type: input.type?.trim() || undefined,
      memo: input.memo?.trim() || undefined,
      labelName: input.labelName?.trim() || undefined,
      sortOrder: input.sortOrder ?? undefined,
      isPublic: input.isPublic ?? current?.isPublic ?? false,
      updatedAt: serverTimestamp(),
    }),
  );

  if ((input.isPublic ?? false) !== (current?.isPublic ?? false)) {
    await setLocationPublic(userId, locationId, input.isPublic ?? false);
  } else if (input.isPublic ?? current?.isPublic) {
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
    cleanObject({
      isPublic,
      publicToken: publicToken ?? undefined,
      updatedAt: serverTimestamp(),
    }),
  );

  if (isPublic && publicToken) {
    await syncPublicLocation(userId, locationId, publicToken);
  } else if (publicToken) {
    await deleteDoc(publicLocationDoc(publicToken));
  }
}

export async function deleteLocation(userId: string, locationId: string) {
  const itemSnapshot = await getDocs(query(itemsCollection(userId), where("locationId", "==", locationId), limit(1)));
  if (!itemSnapshot.empty) {
    throw new Error("中身がある保管場所は削除できません。先にアイテムを移動または削除してください。");
  }

  const location = await getLocation(userId, locationId);
  if (location?.publicToken) {
    await deleteDoc(publicLocationDoc(location.publicToken));
  }
  await deleteDoc(locationDoc(userId, locationId));
}

export async function getArea(userId: string, areaId: string): Promise<Area | null> {
  const snapshot = await getDoc(areaDoc(userId, areaId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Area) : null;
}

export async function getLocation(userId: string, locationId: string): Promise<Location | null> {
  const snapshot = await getDoc(locationDoc(userId, locationId));
  return snapshot.exists() ? ({ id: snapshot.id, isPublic: false, ...snapshot.data() } as Location) : null;
}

export async function getItem(userId: string, itemId: string): Promise<Item | null> {
  const snapshot = await getDoc(itemDoc(userId, itemId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Item) : null;
}

export async function createItem(userId: string, input: ItemInput) {
  const newItem = await addDoc(
    itemsCollection(userId),
    cleanObject({
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );

  await syncPublicByLocationIfNeeded(userId, input.locationId);
  return newItem;
}

export async function updateItem(userId: string, itemId: string, input: ItemInput) {
  const current = await getItem(userId, itemId);
  if (!current) throw new Error("アイテムが見つかりません。");

  await updateDoc(
    itemDoc(userId, itemId),
    cleanObject({
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
      updatedAt: serverTimestamp(),
    }),
  );

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

async function syncPublicByLocationIfNeeded(userId: string, locationId: string) {
  const location = await getLocation(userId, locationId);
  if (location?.isPublic && location.publicToken) {
    await syncPublicLocation(userId, locationId, location.publicToken);
  }
}

export async function syncPublicLocation(userId: string, locationId: string, fixedToken?: string) {
  const location = await getLocation(userId, locationId);
  if (!location || !location.isPublic) return;

  const area = await getArea(userId, location.areaId);
  const publicToken = fixedToken ?? location.publicToken;
  if (!publicToken) throw new Error("公開用トークンがありません。");

  const itemSnapshot = await getDocs(query(itemsCollection(userId), where("locationId", "==", locationId)));
  const items: PublicItem[] = itemSnapshot.docs
    .map((snapshot) => snapToItem(snapshot))
    .sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }))
    .map((item) => {
    return cleanObject({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit || undefined,
    });
  });

  await setDoc(
    publicLocationDoc(publicToken),
    cleanObject({
      ownerId: userId,
      locationId,
      areaName: area?.name ?? "未分類",
      locationName: location.name,
      labelName: location.labelName || undefined,
      isPublic: true,
      items,
      updatedAt: serverTimestamp(),
    }),
  );
}
