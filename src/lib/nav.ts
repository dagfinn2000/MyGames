/** Which top-bar link a path belongs to (components/nav-link.tsx). A game's
 *  page and its edit page count as the library; adding and checking a game
 *  have links of their own. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/games") {
    return (
      pathname === "/games" ||
      (pathname.startsWith("/games/") &&
        !pathname.startsWith("/games/new") &&
        !pathname.startsWith("/games/check"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
