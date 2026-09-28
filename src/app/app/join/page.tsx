"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/common/LoadingState";
import { JoinHousehold } from "@/components/household/JoinHousehold";

export default function JoinPage() {
  return (
    <Suspense fallback={<LoadingState label="招待を確かめています" />}>
      <JoinHousehold />
    </Suspense>
  );
}
