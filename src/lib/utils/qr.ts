export function makePublicLocationUrl(publicToken: string): string {
  if (typeof window === "undefined") return `/public/locations/${publicToken}`;
  return `${window.location.origin}/public/locations/${publicToken}`;
}

export function makePrivateLocationUrl(locationId: string): string {
  if (typeof window === "undefined") return `/app/locations/${locationId}`;
  return `${window.location.origin}/app/locations/${locationId}`;
}

export function createPublicToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
