import { ThemePicker } from "@/components/theme-picker";

/** A few game cases on a shelf with a controller resting beside them: the
 *  sign-in page's picture, drawn in the theme's accent so it suits every
 *  theme. */
function ShelfOfGames() {
  return (
    <svg
      viewBox="0 0 88 64"
      className="h-16 w-22 text-primary"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="7" y="14" width="11" height="48" rx="1.5" fillOpacity="0.9" />
      <rect x="7" y="19" width="11" height="2.5" className="fill-background" fillOpacity="0.5" />
      <rect x="20" y="14" width="11" height="48" rx="1.5" fillOpacity="0.5" />
      <rect x="20" y="19" width="11" height="2.5" className="fill-background" fillOpacity="0.5" />
      {/* A shorter case, the size handheld games come in. */}
      <rect x="33" y="22" width="9" height="40" rx="1.5" fillOpacity="0.72" />
      <rect x="33" y="26" width="9" height="2" className="fill-background" fillOpacity="0.45" />
      <g transform="translate(45.3 28.6) scale(1.4)">
        <path
          d="M11 10h10c2.8 0 4.9 1.9 5.3 4.6l.9 5.6c.4 2.4-2.6 3.6-4.2 1.9l-2.4-2.5h-9.2L9 22.1c-1.6 1.7-4.6.5-4.2-1.9l.9-5.6C6.1 11.9 8.2 10 11 10z"
          fillOpacity="0.45"
        />
        <path
          d="M9.8 12.8h2.4V14h1.2v2.4h-1.2v1.2H9.8v-1.2H8.6V14h1.2z"
          className="fill-background"
          fillOpacity="0.6"
        />
        <circle cx="20.2" cy="16.6" r="1.15" className="fill-background" fillOpacity="0.6" />
        <circle cx="22.8" cy="14" r="1.15" className="fill-background" fillOpacity="0.6" />
      </g>
      <rect x="2" y="62" width="84" height="2" rx="1" className="fill-foreground" fillOpacity="0.2" />
    </svg>
  );
}

/** Minimal centered layout for the login/register pages — no app nav. */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      {/* A soft wash of the accent colour from the top (globals.css). */}
      <div className="auth-backdrop" aria-hidden="true" />
      <div className="absolute right-4 top-4">
        <ThemePicker />
      </div>
      <div className="grid justify-items-center gap-3">
        <ShelfOfGames />
        <p className="wordmark text-3xl">MyGames</p>
      </div>
      {children}
    </main>
  );
}
