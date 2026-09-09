import { deleteDoc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import type { Location } from "@/lib/types/location";
import type { PublicItem } from "@/lib/types/item";
import {
  getArea,
  getLocation,
  itemsCollection,
  publicLocationDoc,
  snapToItem,
} from "./refs";

/**
 * 公開閲覧用ドキュメント（publicLocations/{publicToken}）の同期をここに集約する。
 * 公開ドキュメントのスキーマを変えたいときは、このファイルだけを見ればよい状態にしておく。
 */

/** 取得済みの location を使って公開ドキュメントを書き出す（location の再読込をしない）。 */
async function writePublicLocation(userId: string, location: Location, fixedToken?: string) {
  const publicToken = fixedToken ?? location.publicToken;
  if (!publicToken) throw new Error("公開用トークンがありません。");

  const area = await getArea(userId, location.areaId);
  const itemSnapshot = await getDocs(query(itemsCollection(userId), where("locationId", "==", location.id)));
  const items: PublicItem[] = itemSnapshot.docs
    .map((snapshot) => snapToItem(snapshot))
    .sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }))
    .map((item) => {
      const publicItem: PublicItem = { name: item.name, quantity: item.quantity };
      if (item.unit) publicItem.unit = item.unit;
      return publicItem;
    });

  await setDoc(publicLocationDoc(publicToken), {
    ownerId: userId,
    locationId: location.id,
    areaName: area?.name ?? "未分類",
    locationName: location.name,
    ...(location.labelName ? { labelName: location.labelName } : {}),
    isPublic: true,
    items,
    updatedAt: serverTimestamp(),
  });
}

/** 公開ONの保管場所なら、公開ドキュメントを最新化する。 */
export async function syncPublicLocation(userId: string, locationId: string, fixedToken?: string) {
  const location = await getLocation(userId, locationId);
  if (!location || !location.isPublic) return;
  await writePublicLocation(userId, location, fixedToken);
}

/** 中身（items）が変わったときの入口。location は1回だけ読む。 */
export async function syncPublicByLocationIfNeeded(userId: string, locationId: string) {
  const location = await getLocation(userId, locationId);
  if (location?.isPublic && location.publicToken) {
    await writePublicLocation(userId, location, location.publicToken);
  }
}

/** 非公開化・保管場所削除時に、公開ドキュメントを消す。 */
export async function deletePublicLocation(publicToken: string) {
  await deleteDoc(publicLocationDoc(publicToken));
}
