"use client";

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import type { Location } from "@/lib/types/location";
import { locationsQuery, snapToLocation } from "@/lib/firebase/firestore";
import { sortLocations } from "@/lib/utils/inventory";

export function useLocations(userId?: string) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setLocations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      locationsQuery(userId),
      (snapshot) => {
        setLocations(sortLocations(snapshot.docs.map(snapToLocation)));
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [userId]);

  return { locations, loading, error };
}
