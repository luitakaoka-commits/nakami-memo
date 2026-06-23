"use client";

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import type { Area } from "@/lib/types/area";
import { areasQuery, snapToArea } from "@/lib/firebase/firestore";
import { sortAreas } from "@/lib/utils/inventory";

export function useAreas(userId?: string) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setAreas([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      areasQuery(userId),
      (snapshot) => {
        setAreas(sortAreas(snapshot.docs.map(snapToArea)));
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [userId]);

  return { areas, loading, error };
}
