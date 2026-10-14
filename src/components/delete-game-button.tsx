"use client";

import { Trash2 } from "lucide-react";
import { deleteGame } from "@/lib/actions/games";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

/** Delete with a confirm dialog — removal also drops the cached cover. */
export function DeleteGameButton({
  gameId,
  title,
}: {
  gameId: string;
  title: string;
}) {
  const action = deleteGame.bind(null, gameId);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 data-slot="icon" />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>
            This permanently removes the game along with your rating, review,
            and play history. There is no undo.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <form action={action}>
            <Button type="submit" variant="destructive">
              Delete game
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
