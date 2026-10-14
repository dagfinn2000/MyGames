import { Fragment } from "react";
import Link from "next/link";

/** A game's developers, each a link to their games in the library. */
export function DeveloperLinks({ developers }: { developers: string[] }) {
  return developers.map((d, i) => (
    <Fragment key={`${i}-${d}`}>
      {i > 0 && ", "}
      <Link
        href={`/games?developer=${encodeURIComponent(d)}`}
        className="hover:text-foreground hover:underline"
      >
        {d}
      </Link>
    </Fragment>
  ));
}
