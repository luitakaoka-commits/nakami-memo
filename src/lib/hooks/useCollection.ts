"use client";

import { useEffect, useState } from "react";
import { onSnapshot, type DocumentData, type Query, type QueryDocumentSnapshot } from "firebase/firestore";

/**
 * Firestoreコレクションを購読する汎用フック。
 * buildQuery は useCallback で安定化させ、null を返すと購読しない（未ログインなど）。
 * toEntity / sort はモジュールレベルの関数を渡す想定（毎回新しい関数を渡すと再購読になる）。
 */
export function useCollection<T>(
  buildQuery: () => Query<DocumentData> | null,
  toEntity: (snapshot: QueryDocumentSnapshot<DocumentData>) => T,
  sort?: (entities: T[]) => T[],
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const targetQuery = buildQuery();
    if (!targetQuery) {
      setData([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const unsubscribe = onSnapshot(
      targetQuery,
      (snapshot) => {
        const entities = snapshot.docs.map((snap) => toEntity(snap));
        setData(sort ? sort(entities) : entities);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [buildQuery, toEntity, sort]);

  return { data, loading, error };
}
