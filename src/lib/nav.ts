/** Which top-bar link a path belongs to (components/nav-link.tsx). A game's
 *  page and its edit page count as the library; adding a game has a link
 *  of its own. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/games") {
    return (
      pathname === "/games" ||
      (pathname.startsWith("/games/") && !pathname.startsWith("/games/new"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
