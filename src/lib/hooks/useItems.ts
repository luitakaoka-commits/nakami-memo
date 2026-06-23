"use client";

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import type { Item } from "@/lib/types/item";
import { itemsQuery, snapToItem } from "@/lib/firebase/firestore";
import { sortByJapaneseName } from "@/lib/utils/inventory";

export function useItems(userId?: string, locationId?: string) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      itemsQuery(userId, locationId),
      (snapshot) => {
        setItems(sortByJapaneseName(snapshot.docs.map(snapToItem)));
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [userId, locationId]);

  return { items, loading, error };
}
