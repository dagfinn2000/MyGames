# Developing MyGames

How to run MyGames from source, run the tests, and find your way around the
code. To just use the app, follow the install steps in the
[README](../README.md) instead.

## Run it locally

You need Node 22+ and a Postgres database. The compose `db` service works
fine for the database.

```bash
cp .env.example .env       # set POSTGRES_PASSWORD and AUTH_SECRET
# Start only the database, reachable on localhost:5432. The dev override
# file publishes the port; the main compose file keeps Postgres private.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
npm install
npx prisma migrate deploy  # create the tables (uses DATABASE_URL from .env)
npm run dev                # http://localhost:3000
```

Outside Docker the app reads `DATABASE_URL` from `.env`. Make sure its
password matches `POSTGRES_PASSWORD`. Every setting is described in
[.env.example](../.env.example). Game search works without any keys
(Wikipedia and Steam); set `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` to
search IGDB as well. The tests never reach the catalogues: they answer
`fetch` with sample responses.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Generate the Prisma client and make a production build |
| `npm run lint` | Run ESLint |
| `npm test` | Unit tests (no database needed) |
| `npm run test:db:docker` | Database tests against a throwaway Postgres container |
| `npm run test:db` | Database tests against the database in `DATABASE_URL` |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run db:prune` | Delete expired search-cache rows (also runs on every container start) |
| `npm run covers:prune` | Report cover files no game uses; add `-- --yes` to delete them |

## Tests

- **`npm test`** covers the pure logic that is easiest to break without
  noticing: parsing typed times ("12:30", "12h 30m", "1.5h") and showing
  them, the play log, pace, forecasts and streaks, what changing a status
  does to dates and time played, which day a date falls on in each time
  zone, parsing each catalogue's answers (IGDB, Wikipedia and Wikidata,
  Steam) from sample responses and merging the rows for one game, platform
  names, catalogue links, sorting and grouping the library and series in
  order, the sorting rules and alphabets, saved library views, counting
  stats and play goals, preferences and themes, the colours of drawn
  covers, the game room's shelves, cases and spine colours, the avatar and
  pets, lending, the rate limiter, the guard that stops cover downloads
  from reaching private addresses, image type detection, and the size
  limits on uploads and backup files.
- **`npm run test:db:docker`** starts a `postgres:16-alpine` container, runs
  the database tests, and removes it. They cover backup and restore (the
  round trip, merging, duplicates, and settings), replay counts and the
  time each playthrough keeps, the game form and the play log it writes,
  logging and fixing time, library search and filters, bulk edit, stats
  and goals, saving preferences and saved views, and the checks that stop
  one user from touching another user's games.

These run against a real database because a stand-in would copy Postgres's
behaviour wrongly in exactly the places that matter, and because restore is
the one feature whose failure loses data you can't get back.

CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs lint, the
type check, both test suites and a production build on every pull request.

## Tech stack

- [Next.js 16](https://nextjs.org/) (App Router, TypeScript), built as a
  standalone server for a small Docker image
- [PostgreSQL](https://www.postgresql.org/) with [Prisma](https://www.prisma.io/)
- [Auth.js v5](https://authjs.dev/): username and password, JWT sessions,
  passwords hashed with bcrypt
- [Tailwind CSS v4](https://tailwindcss.com/) and [shadcn/ui](https://ui.shadcn.com/)
- [Zod](https://zod.dev/) for validation and [Vitest](https://vitest.dev/) for tests

## Project layout

```
src/
├─ app/
│  ├─ (auth)/          login and register pages
│  ├─ (app)/           pages behind login: games (the library), games/new,
│  │                   games/[id], games/[id]/edit, playing (Now
│  │                   playing), room (the game room), stats,
│  │                   stats/year/[year], account
│  └─ api/             Auth.js, register, metadata search/details/covers,
│                      cover upload and serving, backup export and import
├─ components/         UI components (shadcn/ui primitives in components/ui);
│                      game-form.tsx with time-to-beat-field.tsx is the
│                      add and edit form; playing-card.tsx ("My
│                      playthrough"), quick-log.tsx, progress-log.tsx and
│                      playthrough-history-card.tsx are the play
│                      tracking on a game's page; game-room.tsx,
│                      room-art.tsx, room-shells.ts, room-rooms.tsx (the
│                      added rooms' furniture) and room-extras.tsx (the
│                      furniture catalogue) draw the game room, with its
│                      colours in game-room.css; room-view.tsx is its
│                      Decorate panel; avatar-art.ts draws the player's
│                      avatar, room-avatar.tsx walks it about and
│                      avatar-maker.tsx is its maker
├─ lib/
│  ├─ actions/         server actions for every change, each checking that
│  │                   the data belongs to the signed-in user
│  ├─ metadata/        IGDB, Wikipedia (with Wikidata) and Steam clients,
│  │                   index.ts asking them together and merging the rows
│  │                   for one game (match.ts), links.ts turning a
│  │                   catalogueId back into its catalogue and page,
│  │                   plus the database cache
│  ├─ catalogue-values.ts
│  │                   a catalogue's game as the form's values
│  ├─ cover-art.ts     colours and layout of drawn covers
│  ├─ cover-flight.ts  a game's cover flying to its page, and back to the
│  │                   library when the page is closed
│  ├─ covers.ts        downloading and caching cover images
│  ├─ dates.ts         which calendar day a date falls on, by time zone
│  ├─ library-return.ts
│  │                   where a game page's X goes back to: the library
│  │                   page it was opened from, and how far down it was
│  ├─ avatar.ts        the avatar's choices and their colours
│  ├─ motion.ts        whether animations may run right now
│  ├─ net-guard.ts     blocks cover downloads from private addresses
│  ├─ pace.ts          time played a day, and when the usual time to
│  │                   beat will be reached
│  ├─ platforms.ts     catalogue platform names as everyday ones, and the
│  │                   platform field's suggestions
│  ├─ play-log.ts      where a logged time goes in the play log
│  ├─ play-state.ts    what a status change does to dates, time played
│  │                   and the completed count
│  ├─ preferences.ts   the Preferences settings and their defaults
│  ├─ progress-units.ts
│  │                   parsing typed times and showing them ("12:30",
│  │                   "12 h 30 min of about 40 h · 31%")
│  ├─ rate-limit.ts    in-memory limits for sign-in, registration,
│  │                   catalogue lookups and cover uploads
│  ├─ room.ts          the game room's layout: case sizes, shelves,
│  │                   and where shelving units and furniture go as it
│  │                   grows or as the player moves it
│  ├─ room-styles.ts   the game room's house styles and colours
│  ├─ sky.ts           the Sky background: how high the sun is where
│  │                   the player's time zone is, as colours
│  ├─ spine-colour.ts  a case's colour, picked from its cover
│  ├─ stats-count.ts   what counts as a game completed or an hour played,
│  │                   by the stats preferences
│  └─ validation.ts    Zod schemas shared by actions and API routes
├─ auth.config.ts      Auth.js config that is safe to run in proxy.ts
├─ auth.ts             full Auth.js config (credentials, Prisma, bcrypt)
└─ proxy.ts            sends signed-out visitors to the login page
                       (Next 16's new name for middleware.ts)
```

## Design decisions

- **Play data lives on the Game row.** Each game belongs to one user, so
  a separate "play entry" table would add nothing. The Game row holds the
  current or latest playthrough; earlier ones are archived in the
  `Playthrough` table, and `timesCompleted` is worked out from both.
- **Time played is the position.** Progress is one number, the minutes
  played so far in the current playthrough (`Game.playedMinutes`), and
  each play-log entry is that total at the moment it was logged
  (`ProgressEntry.minutes`), the way a save screen shows it. The time
  played on a day is the difference between consecutive entries, so the
  play calendar, the pace, hours played and hours goals all count the same
  thing. A new playthrough starts with a 0-minute entry as its anchor, so
  the first time logged after it counts in full. Completing a game you
  were logging, with a later time typed, closes the log at that time on
  the finish day. Otherwise a time typed on a completed game is how long
  it took, not time played that day, so it isn't logged; stats count it
  on the day the game was completed. There
  are no pages, percentages or per-format units: a digital or
  subscription game is tracked like a boxed one. Typed times are parsed
  in one place,
  [progress-units.ts](../src/lib/progress-units.ts): "12:30" and "12.30"
  are twelve and a half hours, "1.5h" is an hour and a half, and a bare
  "90" is minutes.
- **The time to beat is optional, and never a limit.** `Game.lengthMinutes`
  is a yardstick. When it's known, progress shows as a share of it (a bar
  stays full past 100%) and the forecast counts down to it; when it isn't,
  the game page just says how long you've played. Time played can run past
  it, and nothing refuses, clamps or asks "finished?" when it's reached:
  plenty of players play on, and Finished is there when they're done. Only
  IGDB knows times to beat, so when IGDB is set up, a game picked from
  Wikipedia or Steam, or looked up after being typed in by hand, gets
  IGDB's time for the game with exactly the same title, and none when
  there is no such game.
- **Playthroughs keep their time.** Completing a game keeps
  `playedMinutes` as the time that playthrough took ("Completed in 42 h"),
  and dropping it keeps where you stopped; only putting a game back on
  Want to Play clears it. "Play it again" archives the playthrough into
  `Playthrough` with its dates, rating and time, then starts a new one
  from zero. One function, `settlePlayState` in
  [play-state.ts](../src/lib/play-state.ts), applies these rules for the
  game page, the add form and bulk edit alike. The stats read the same
  minutes either way: hours played can count the time logged, day by day,
  or each completed playthrough's whole time on the day it was completed
  (the `statsHoursPlayed` preference).
- **Catalogue entries are remembered by a prefixed id.** `Game.catalogueId`
  says which catalogue a game came from and which entry it is:
  `igdb:<slug>`, `steam:<app id>` or `wikidata:<item id>` (Wikipedia
  articles are found through the Wikidata item behind them, which is
  stable when an article is renamed). "Look up details" asks that entry's
  own catalogue again, the game page links to it
  ([links.ts](../src/lib/metadata/links.ts)), and a restore treats a game
  with the same id on the same platform (or with no platform on one side)
  as one it already has. IGDB needs
  Twitch credentials (`IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`); its access
  token is kept in memory until a minute before it expires. Without them
  IGDB is simply not asked, and the other two need no keys.
- **Ratings are stored as whole numbers from 1 to 10**, in half stars. `7`
  shows as 3.5 stars, or as 7/10 for someone who rates out of 10. Changing
  the rating style only changes how ratings look and are entered, never the
  stored numbers.
- **Settings are one JSON value per account.** Preferences live in
  `User.preferences` and the library's look in `User.libraryView`. Each is
  read through a parse function (`parsePreferences`, `parseLibraryView`)
  that fills in a default for anything missing or wrong. Adding a setting
  means adding it there; older rows just get the default. Saves merge the
  changed keys in SQL, so two quick changes can't undo each other.
- **Appearance settings are attributes on `<html>`.** The root layout
  writes the theme, accent, fonts, corners, card style, background, cover
  style, game page backdrop and animation setting as `data-*` attributes,
  and
  [globals.css](../src/app/globals.css) does the rest, so server and client
  components never pass them down. Preferences sets the attribute at once
  as well as saving, so a change shows without waiting for the server.
- **Motion always has an off switch.** One CSS rule stops every animation
  and transition when the device asks for reduced motion or Animations is
  off, and animations started from script (confetti, the theme reveal, the
  cover flying to a game's page and back) check the same two things through
  `motionAllowed()` in [motion.ts](../src/lib/motion.ts).
- **Moving backgrounds slide pictures, they don't redraw them.**
  [background-scene.tsx](../src/components/background-scene.tsx) puts one
  fixed layer under the page, and everything in it moves by `transform` or
  fades by `opacity` alone. Rain, snow and stars must not look tiled, so
  the far-off marks are two or three tiles (in `public/textures`) of sizes
  that share no factor, laid over each other as masks over a theme colour
  and moved one tile per loop so they never jump; the near drops, flakes
  and bright stars are each their own element, scattered by a seeded random
  generator so the server and the browser agree. When animations may not
  play, or "Moving backgrounds" is off, rain, snow and stars hold still
  where they are, and aurora and ripples show their still textures. The
  Sky background is worked out from the sun's height where the player's
  time zone is ([sky.ts](../src/lib/sky.ts)), on the server for the first
  paint and then once a minute in the browser.
- **The game room is drawn in code**, with no image files. Its pixel art
  is rectangles ([room-art.tsx](../src/components/room-art.tsx)), each
  naming a paint whose colour lives in
  [game-room.css](../src/components/game-room.css), which has a day
  palette for light themes and a night one for dark themes. Spine colours
  are read from the covers in the browser as each floor scrolls into view,
  and kept in localStorage by cover address, which changes whenever the
  image does. The house's shell (roof, walls, floors, garden) is drawn per
  style in [room-shells.ts](../src/components/room-shells.ts); the cottage
  keeps a hand-picked palette, and every other style gives a few base
  colours per part (`--s-*`) that the shades and the night version are
  worked out from, so a Decorate colour pick repaints any style. The
  decoration and where the furniture stands are Preferences
  (`roomStyle`, `roomLayout` and the rest); placements name a floor and a
  place among the pieces there, so they survive a different screen width,
  falling back to where a piece would go by itself when it doesn't fit.
  Added rooms (`roomRooms`) are floors over the library's own, in the
  order they were added; a piece moved into one names the room rather
  than a floor number, so it stays put as the library grows underneath.
  Furniture added from the catalogue (`roomExtras`) goes wherever there
  is space, like the library's own; no floor is added just to hold it, so
  on a narrow screen a piece may wait for space, and Decorate says so.
  The avatar is painted dot by dot and outlined in code
  ([avatar-art.ts](../src/components/avatar-art.ts)) in layers, from a
  cape behind to a hat on top, and coloured from five `--av-*` colours, so
  a colour pick redraws nothing. Its look is one Preferences value
  (`avatar`), checked by `parseAvatar` in [avatar.ts](../src/lib/avatar.ts),
  which also reads the looks saved before the wardrobe. The tests draw
  every hairstyle under every hat and every outfit, and check each stays
  outlined and fits the armchair. Its walk is the
  one piece of the room moved by script rather than CSS, so it checks
  [motion.ts](../src/lib/motion.ts) and stands still when animations are
  off.
- **Typed dates and moments are read differently.** A date typed into a date
  field is stored as midnight UTC and means that day everywhere. Anything
  else, like "finished today" or a play-log entry, is a moment, and
  counts on the day it was in the player's time zone. `calendarDay` in
  [dates.ts](../src/lib/dates.ts) applies the rule. The time zone is taken
  from the browser on the first visit and can be changed in Preferences.
- **Catalogue lookups are cached** in the `MetadataCache` table for a week,
  keyed by source and query. If a source is down, the last good answer is
  used, so a flaky catalogue doesn't break lookups that worked before.
- **Cover images are stored locally.** After a save, the cover is downloaded
  to `COVERS_DIR` in the background (with `after()`, so saving never waits
  for it) and the game is pointed at `/api/covers/<id>-<hash>.<ext>`. The
  hash in the name means a changed cover gets a new URL, so browsers can
  cache covers forever. A slow host gets one retry. If the download fails,
  the game keeps the remote URL. A cover file is deleted only when no game
  uses it any more.
- **Changes go through server actions** that check ownership, and pages
  are server components that query Prisma directly. API routes are used
  only where the browser has to call the server itself: sign-in and
  registration, metadata search, cover upload and serving, and backup
  download and restore.
- **Migrations run when the container starts** (`prisma migrate deploy` in
  [docker-entrypoint.sh](../docker-entrypoint.sh)). The first start creates
  the tables, later starts apply anything new, and an up-to-date database is
  left alone.
