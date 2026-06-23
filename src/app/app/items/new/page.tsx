import { Suspense } from "react";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemForm } from "@/components/items/ItemForm";

export default function NewItemPage() {
  return (
    <Suspense fallback={<LoadingState label="フォームを準備中" />}>
      <ItemForm />
    </Suspense>
  );
}
