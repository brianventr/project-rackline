/** Where a person lands after sign-in: operators on the floor, everyone else on Today. */
export function homePath(role: string | null | undefined): string {
  return role === "operator" ? "/floor" : "/today";
}
