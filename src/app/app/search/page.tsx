import { Suspense } from "react";
import { LoadingState } from "@/components/common/LoadingState";
import { InventorySearch } from "@/components/items/InventorySearch";

export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingState label="検索画面を準備中" />}>
      <InventorySearch />
    </Suspense>
  );
}
