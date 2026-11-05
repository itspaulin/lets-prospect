// A person who clicked the opt-out link. Only the hash of the address is kept, same as the suppression list.
export type OptOut = { hash: string; at: string };

export interface Unsubscribe {
  // Personal, signed link for one recipient. Anyone without the secret cannot build a link for someone else.
  url(email: string): string;
  // Every opt-out the service holds. Throws when the service cannot be reached.
  fetchOptOuts(): Promise<OptOut[]>;
}
