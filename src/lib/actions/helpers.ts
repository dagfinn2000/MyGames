import { auth } from "@/auth";

/** Result shape shared by every form-backed server action. */
export interface ActionState {
  error?: string;
  success?: boolean;
  /** Set by updatePlay when the save marked the game as completed, so the
   *  playing card can celebrate. */
  finished?: boolean;
  /** Set by createGame when the player chose "Add and add another": the
   *  form stays on the add page and says what was added. */
  added?: { id: string; title: string };
}

/** All actions require a session; returns the user id or throws. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}
