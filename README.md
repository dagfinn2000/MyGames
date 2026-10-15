# MyGames

Personal self-hosted video game library and play tracker. Keep track of the
games you own, what you're playing, how long it's taking, and what you
thought of them, on your own server.

MyGames is a sibling of [MyReads](https://github.com/dagfinn2000/MyReads),
the same app for books, and is built from the same code.

## What it does

**Adding games**

- Search by title and import the details from
  [IGDB](https://www.igdb.com/) (optional, with a free Twitch developer
  application), [Wikipedia](https://en.wikipedia.org/) and the
  [Steam](https://store.steampowered.com/) store. No catalogue knows every
  game well: IGDB has the console games and how long games take to beat,
  Steam nearly every PC game, small ones included, and Wikipedia the older
  and better-known ones. So their results are shown side by side, and a
  game found in more than one shows up once. You choose which of them to
  search and in what order. You can check and edit everything before
  saving, or type a game in by hand.
- Each game has the platform you play it on. The form suggests the
  platforms the catalogue lists for the game, then the common ones, and you
  can type any other system.
- "Add and add another" brings you straight back for the next game. In
  Preferences you choose what adding a game does: open it, add another, or
  go to the library.
- A game added as Completed can say when you finished it, or that you don't
  remember, so years of old games don't land in this year's stats. A game
  added as Playing can say when you started and how long you've played so
  far.
- Genres from the catalogues can be copied in as tags: all of them, only
  the tags you already use, or none. Renaming or removing a tag in Manage
  tags can apply to future imports too.
- "Look up details" on a game's edit page fills in what's missing, like the
  time to beat, from the catalogues. Anything that would replace what you
  typed is offered unticked.
- Choose a cover from the catalogues' box art, paste an image link, or
  upload a photo. Covers are stored on your server.

**Tracking your play**

- Status (Want to Play, Playing, Completed, Dropped), ratings, notes, and
  start and finish dates. Rate in half stars, whole stars or out of 10, or
  switch ratings off.
- Log your time played as you go: type the total from your save screen
  ("12:30", "12h 30m" or "45m"), or tap a step button to add a session's
  worth (+30 min and +1 h, or other steps in Preferences). Time is logged
  by hand; nothing is read from Steam or a console. Every entry goes into
  the game's play log, which you can fix if you typed something wrong.
- The game page shows your pace ("about 1 h 20 min a day"). A game's
  usual time to beat is optional; when it's known, the page also shows how
  far along you are ("12 h 30 min of about 40 h · 31%") and when you're
  likely to get there. Playing on past it is fine: nothing stops you or
  asks you to finish.
- A completed game keeps the time it took ("Completed in 42 h"), and a
  dropped one where you stopped.
- Play it again: the playthrough you finished goes into the game's history
  with its dates, rating and time, and a new one starts at zero. Games you
  played before MyGames can have past playthroughs added by hand, with the
  time they took and a note like "100% on hard". Replays count in your
  stats.
- The Playing page lists every game you're playing with its own time box,
  so logging an evening's play doesn't mean opening each game, and
  Finished and Stopped buttons (with Undo). Under them is what's up next
  from Want to Play, the next game in a series you've started first.
- Save favourite quotes with who says them, and search all of them on the
  Quotes page.

**Organising your library**

- Custom shelves, tags, series in order, platform, format (physical,
  digital, subscription) and ownership (owned, wishlist, borrowed, no
  longer have it).
- Keep track of who borrowed your games and when.
- Search, filter, sort and group the library: by developer, platform,
  series, year finished, status, format, ownership, tag, shelf or rating.
  Filter by platform, or find the games missing a cover, a time to beat, a
  platform or tags. "Pick for me" opens a random game from Want to Play.
- A game opened from the library has an X in its corner (or press Esc) that
  takes you back to the same spot in the library, with your filters still
  on.
- Show the library as cards, bare covers or a shelf, in three sizes, or
  as a list, and choose what each game shows. Covers can look like little
  game cases, and games without a cover get one drawn with their title.
  Save the searches and filters you use often as views, and open the
  library on one of them if you like.
- Edit many games at once: set their status, format or ownership, add or
  remove tags, put them on a shelf or take them off it, or delete them.
  Pick the games on screen, or every game that matches your filters.
- Rename, merge, reorder and hide shelves, and choose which status tabs the
  library shows. Saved views can be renamed and reordered too.

**Stats**

- Games completed and hours played per year, ratings, genres and tags,
  platforms and formats, and a calendar of the days you played. Look at all
  time, this year, the last 12 months or the last 30 days.
- Decide what counts: the time you log, on the day you play, or a game's
  whole time when you complete it; and whether games you drop count, by
  their hours or as a game.
- A "year in review" page for every year, with your best games, the one you
  played most, your top platform and your biggest day. Yearly play goals
  in games or hours, with or without replays. The goal shows whether
  you're on track, and next year's can be set ahead of time.

**The game room**

- Your library drawn as a cozy pixel-art house. Every game is a case on a
  shelf, filed by platform and coloured from its cover: handheld games
  stand in slim cases and boxed PC games in big boxes. Point at one to see
  its title and platform, click it to open the game; the game's X puts it
  back on its shelf.
- The house grows with your library: more shelving units, then more
  floors, and furniture moves in as you add games, from a plant and a cat
  asleep in the armchair to a clock, a library ladder, a window seat and a
  study.
- A ribbon marks the games you're playing, and games on your wishlist, lent
  out or sold keep their place as an outline. Light themes show it by
  day; dark themes by lamplight, with the fire going.
- Decorate it: ten house styles (a cottage, a castle, a wizard's house, an
  elven hall, a cave in a hill, a space station, a modern house, a log
  cabin, a tea house and a workshop), each with its own roof, walls and
  garden, and things that move, from a banner on the battlements to a gear
  on the workshop's gable and fireflies among the birches. Pick the colour
  of the walls, the wood and the fabrics, hang a painting or one of five
  tapestries over the fireplace, put furniture away, and drag the furniture
  to wherever you like it (or move it with the arrow keys).
- Add rooms over the library, each a floor of its own: a kitchen with the
  kettle on the range, a bedroom under a patchwork quilt, a music room, a
  conservatory with a songbird, a billiard room with a dartboard, a
  studio with an easel, a bathroom with a bubble bath, a dining room under
  a chandelier, a nursery with a mobile over the cot, a woodshop, a sauna
  with steam rising off the stove, or a spare room to fill yourself. The
  bathroom comes tiled and the sauna panelled in logs. Their furniture
  can be moved anywhere in the house or put away like the rest.
- Paper the walls (stripes, damask, flowers, trellis, stars, stone, tiles,
  paper screens and more) and lay the floor (boards, parquet, flagstones,
  chequered tiles, carpet, tatami or a metal grate), for the whole house
  and for each added room on its own, which can have walls of its own
  colour too. String fairy lights, bunting, paper lanterns or ivy along
  the ceilings; at night the fairy lights twinkle.
- Add furniture from a catalogue: a Chesterfield sofa, a rocking chair, an
  aquarium with fish swimming in it, a spaniel asleep in its basket, a suit
  of armour, a sea chest, a coat stand, a telescope, a rocking horse, a
  curio cabinet, a spinning wheel, a bean bag, a macaw on its perch, a
  monstera, a standing mirror, a wood stove, an old radio playing, a tea
  trolley and a dollhouse. Each goes wherever there's space, and you can
  move it from there.
- Make a little you who lives there, from a wardrobe: ten skin tones (an
  elf or a spaceman too), eyes in seven colours, round or pointed ears, a
  mouth, blush or freckles, a beard, 23 hairstyles in 14 colours, three
  heights, jumpers, shirts, hoodies, a coat, a dress or a robe, trousers,
  jeans, shorts, skirts or dungarees, six kinds of shoes, 24 hats from a
  beanie to a halo (a headscarf, a turban, a head wrap and a kippah
  among them), and glasses, a monocle, an eye patch, hearing aids,
  earrings, a scarf, headphones, a backpack, a cape or fairy wings, all in
  colours of your choosing. Get about on foot, with a walking stick or in
  a wheelchair, and carry a mug of tea, a game controller, a book, a
  lantern, a magic wand, a teddy bear or a sunflower. Keep up to six looks
  to switch between, or let Surprise me pick. They potter about the house
  and stop by the fire, and while you're playing a game they sit in the
  armchair with a controller, playing it (the cat moves to the rug). With
  animations off they stand still by the fire.
- Bring a pet: a cat, a dog, a rabbit, a hedgehog, a fox or a little
  dragon trots at your avatar's heels and curls up at its feet while it
  plays. Choose the coat of every cat in the house (ginger, tabby, black,
  white, grey, calico or Siamese) and of the dog.
- Not for you? Turn the game room off in Preferences, or from Decorate,
  and the Room tab goes away. You can also keep the house and leave the
  avatar out.

**Everything else**

- Download a backup (a zip with everything, covers and settings included)
  and restore it on any MyGames server.
- 26 colour themes, or a light and a dark one that switch with your device,
  with an accent colour of your own on top if you like. Your choice follows
  you to every device you sign in on.
- Preferences on the Account page: date and number formats, your time zone
  and the first day of the week, how titles sort, what new games start as,
  the step buttons for logging time and where your pace comes from, text
  size, a serif font for reviews and quotes, the font for headings, how
  round the corners are, flat, raised or frosted cards, one of 26
  background textures (one of them, Sky, follows the time of day where you
  are), a wash of the cover's colours behind each game's page, which cards
  a game's page shows and in what order, which page opens first, and which
  links and stats cards you see.
- "Find it at" links on every game's page, to sites of your choosing
  (HowLongToBeat, PCGamingWiki, a price tracker), with the game's title,
  developer or platform filled in.
- A little motion: pages fade in, a game's cover flies to its page and back
  into its place in the library when you close it, bars fill up,
  completing a game or reaching your goal sets off confetti, and the
  game room's fire flickers. On the Rain, Snow, Starry night, Aurora and
  Ripples backgrounds, rain falls, snow drifts, stars twinkle and the odd
  one shoots across the night, the light shifts and drops ripple the pond.
  Animations can be turned off (or only the backgrounds kept still), and
  stay off when your device asks for reduced motion.
- Install it on your phone's home screen like an app.

Deliberately out of scope: anything social, recommendation engines, and CSV
import.

## Install

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose.

1. Get the code and make a settings file:

   ```bash
   git clone https://github.com/dagfinn2000/MyGames.git
   cd MyGames
   cp .env.example .env
   ```

2. Open `.env` and change two values:
   - `POSTGRES_PASSWORD`: any long random string.
   - `AUTH_SECRET`: paste the output of `openssl rand -base64 32`.

3. Start MyGames:

   ```bash
   docker compose up -d
   ```

4. Open <http://localhost:3000>, register an account, and add your first
   game.

The first start builds the app, so it takes a while. The database is set up
automatically.

## After installing

- **Close registration.** Once you have your account, set
  `DISABLE_REGISTRATION=true` in `.env` and run `docker compose up -d` again
  so nobody else can sign up.
- **Add IGDB to search, if you like.** Wikipedia and Steam work without any
  keys. IGDB needs a free Twitch developer application: sign in at
  [dev.twitch.tv/console](https://dev.twitch.tv/console) with a Twitch
  account (two-factor authentication has to be on), register an
  application with `http://localhost` as its OAuth redirect URL and
  Confidential as its client type, then press **New Secret**. Put the
  client ID and the secret in `.env` as `IGDB_CLIENT_ID` and
  `IGDB_CLIENT_SECRET`, and run `docker compose up -d` again. IGDB then
  shows up under Game search in Preferences.
- **Use HTTPS to install it on a phone.** Browsers only offer to install the
  app on HTTPS or `localhost`, so on a plain `http://192.168.x.x` address
  you can use MyGames in the browser but not add it to your home screen.
  Put MyGames behind a reverse proxy with HTTPS (for example Caddy, nginx
  or Traefik). With nginx, add `client_max_body_size 200m;` too: nginx
  turns away uploads over 1 MB by default, which stops most backups from
  being restored.
- **Make backups.** On the Account page, **Download backup** saves
  everything as a zip. **Restore backup** on the same page loads one into any
  MyGames server. Games you already have are skipped, so restoring twice is
  safe. The Backup card shows when you last downloaded one, and its
  **Remind me to back up** setting (not in Preferences) can put a note on
  the Library and Stats pages once a month.
- **Know where your data is.** The library lives in two Docker volumes:
  `pgdata` (the database) and `covers` (cover images).
- **Update.** Run `git pull`, then `docker compose up -d --build`. Database
  changes are applied automatically when the app starts.

## Server settings

These are the settings in `.env` you are most likely to change. The rest are
explained in [.env.example](.env.example). Personal choices are made in the
app instead: date formats, time zone and the rest under Preferences on the
Account page, and the theme with the palette button in the top bar.

| Setting | Needed? | What it does |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | **yes** | Password for the database. |
| `AUTH_SECRET` | **yes** | Secret that signs logins. Make one with `openssl rand -base64 32`. |
| `DISABLE_REGISTRATION` | no | `true` stops new accounts from being created. |
| `IGDB_CLIENT_ID` | no | With `IGDB_CLIENT_SECRET`, adds IGDB to search, which knows the most console games and how long games take to beat. Both come from a free Twitch developer application (see above). |
| `IGDB_CLIENT_SECRET` | no | The secret of that application. |
| `APP_PORT` | no | Port MyGames runs on (default `3000`). |

## Cleaning up cover images

Cover images that no game uses any more, for example from an upload you
never saved, stay on disk. To see how many there are, then delete them:

```bash
docker compose exec app node scripts/prune-covers.mjs        # report only
docker compose exec app node scripts/prune-covers.mjs --yes  # delete
```

Files less than a day old are always kept. Old search results are cleaned up
automatically every time the app starts.

## Development

MyGames is a [Next.js](https://nextjs.org/) app with PostgreSQL and
[Prisma](https://www.prisma.io/). To run it without Docker you need Node 22+
and a Postgres database. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for
setup, tests, the project layout and the main design decisions.

## License

[MIT](LICENSE)
