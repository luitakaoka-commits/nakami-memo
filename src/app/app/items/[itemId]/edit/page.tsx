"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemForm } from "@/components/items/ItemForm";

export default function EditItemPage() {
  const params = useParams<{ itemId: string }>();
  return (
    <Suspense fallback={<LoadingState label="フォームを準備中" />}>
      <ItemForm itemId={params.itemId} />
    </Suspense>
  );
}
