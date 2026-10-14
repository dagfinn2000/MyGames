import { Fragment } from "react";
import Link from "next/link";

/** A game's authors, each a link to their games in the library. */
export function AuthorLinks({ authors }: { authors: string[] }) {
  return authors.map((a, i) => (
    <Fragment key={`${i}-${a}`}>
      {i > 0 && ", "}
      <Link
        href={`/games?author=${encodeURIComponent(a)}`}
        className="hover:text-foreground hover:underline"
      >
        {a}
      </Link>
    </Fragment>
  ));
}
