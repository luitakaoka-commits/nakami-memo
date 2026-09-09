import {
  collection,
  doc,
  getDoc,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { Area } from "@/lib/types/area";
import type { Item } from "@/lib/types/item";
import type { Location } from "@/lib/types/location";
import { db } from "./client";

export const usersDoc = (userId: string) => doc(db, "users", userId);
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

export function snapToArea(snapshot: QueryDocumentSnapshot<DocumentData>): Area {
  return { id: snapshot.id, ...snapshot.data() } as Area;
}

export function snapToLocation(snapshot: QueryDocumentSnapshot<DocumentData>): Location {
  return { id: snapshot.id, isPublic: false, ...snapshot.data() } as Location;
}

export function snapToItem(snapshot: QueryDocumentSnapshot<DocumentData>): Item {
  return { id: snapshot.id, ...snapshot.data() } as Item;
}

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
