"use client";

import { useParams } from "next/navigation";
import { LocationForm } from "@/components/locations/LocationForm";

export default function EditLocationPage() {
  const params = useParams<{ locationId: string }>();
  return <LocationForm locationId={params.locationId} />;
}
