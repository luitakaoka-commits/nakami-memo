import type { Item, ItemWithLocation } from "@/lib/types/item";
import type { Area } from "@/lib/types/area";
import type { Location } from "@/lib/types/location";
import { daysUntil } from "./dates";

export function isLowStock(item: Item): boolean {
  return typeof item.lowStockThreshold === "number" && item.quantity <= item.lowStockThreshold;
}

export function sortByJapaneseName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
}

export function sortLocations(locations: Location[]): Location[] {
  return [...locations].sort((a, b) => {
    const orderA = typeof a.sortOrder === "number" ? a.sortOrder : Number.POSITIVE_INFINITY;
    const orderB = typeof b.sortOrder === "number" ? b.sortOrder : Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name, "ja", { numeric: true });
  });
}

export function sortAreas(areas: Area[]): Area[] {
  return [...areas].sort((a, b) => {
    const orderA = typeof a.sortOrder === "number" ? a.sortOrder : Number.POSITIVE_INFINITY;
    const orderB = typeof b.sortOrder === "number" ? b.sortOrder : Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name, "ja", { numeric: true });
  });
}

export function joinItemsWithLocations(items: Item[], locations: Location[], areas: Area[]): ItemWithLocation[] {
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const areaMap = new Map(areas.map((area) => [area.id, area]));

  return items.map((item) => {
    const location = locationMap.get(item.locationId);
    const area = location ? areaMap.get(location.areaId) : undefined;
    return {
      ...item,
      locationName: location?.name ?? "不明な保管場所",
      areaName: area?.name ?? "未分類",
    };
  });
}

export function getExpiringItems<T extends Item>(items: T[], withinDays = 7): T[] {
  return items
    .filter((item) => {
      const days = daysUntil(item.expirationDate);
      return days !== null && days <= withinDays;
    })
    .sort((a, b) => {
      const da = daysUntil(a.expirationDate) ?? Number.POSITIVE_INFINITY;
      const db = daysUntil(b.expirationDate) ?? Number.POSITIVE_INFINITY;
      return da - db;
    });
}

export function searchInventory(items: ItemWithLocation[], keyword: string): ItemWithLocation[] {
  const query = keyword.trim().toLowerCase();
  if (!query) return sortByJapaneseName(items);

  return items.filter((item) => {
    const target = [
      item.name,
      item.category,
      item.memo,
      item.locationName,
      item.areaName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return target.includes(query);
  });
}
