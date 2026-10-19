"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GameFormat, GameOwnership, PlayStatus } from "@prisma/client";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { savePreferences } from "@/lib/actions/preferences";
import { deleteView, renameView } from "@/lib/actions/saved-views";
import { moveId, orderByIds } from "@/lib/library-order";
import { SAVED_VIEW_NAME_MAX } from "@/lib/saved-views";
import {
  FORMAT_LABELS,
  OWNERSHIP_LABELS,
  STATUS_LABELS,
  formatDayKey,
  formatNumber,
} from "@/lib/display";
import { HEATMAP_STEPS } from "@/lib/heatmap";
import {
  ACCENTS,
  BACKGROUNDS,
  CATALOGUES,
  DATE_FORMATS,
  HIDEABLE_NAV,
  HIDEABLE_STATS,
  NUMBER_FORMATS,
  QUICK_LOG_STEPS,
  STATS_PERIODS,
  SEARCH_FIELDS,
  type Accent,
  type Background,
  type Catalogue,
  type HideableNav,
  type HideableStat,
  type Preferences,
  type SearchField,
} from "@/lib/preferences";
import { formatPlaytime, stepsFor } from "@/lib/progress-units";
import { PERIOD_LABELS } from "@/lib/stats-period";
import { cn } from "@/lib/utils";
import { GamePageCardList, FindLinksEditor } from "@/components/game-page-preferences";
import { TagRulesList } from "@/components/tag-rules-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATALOGUE_LABELS: Record<Catalogue, string> = {
  igdb: "IGDB",
  wikipedia: "Wikipedia",
  steam: "Steam",
};

const SEARCH_FIELD_LABELS: Record<SearchField, string> = {
  tags: "Tags",
  review: "My review",
};

const NAV_LABELS: Record<HideableNav, string> = {
  playing: "Now playing",
  room: "Game room",
};

const ACCENT_LABELS: Record<Accent, string> = {
  theme: "Theme default",
  rose: "Rose",
  orange: "Orange",
  amber: "Amber",
  emerald: "Emerald",
  teal: "Teal",
  sky: "Sky",
  indigo: "Indigo",
  violet: "Violet",
  fuchsia: "Fuchsia",
};

/**
 * Appearance settings that the root layout puts on <html> as data
 * attributes, keyed by preference. The form sets the attribute straight
 * away as well as saving, so a change shows at once instead of after the
 * server round trip; the refreshed layout then writes the same value.
 */
const HTML_ATTRIBUTES: Partial<Record<keyof Preferences, string>> = {
  headingFont: "data-heading-font",
  motion: "data-motion",
  coverArt: "data-covers",
  accent: "data-accent",
  corners: "data-corners",
  cardStyle: "data-cards",
  background: "data-background",
  backgroundMotion: "data-background-motion",
  gameBackdrop: "data-game-backdrop",
};

/** The accent colour swatches, one round button each. */
function AccentPicker({ value, onChange }: { value: Accent; onChange: (a: Accent) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-4">
      <div>
        <p className="text-sm font-medium">Accent colour</p>
        <p className="text-xs text-muted-foreground">Buttons, links, progress bars and focus rings.</p>
      </div>
      <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap items-center gap-1.5">
        {ACCENTS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={value === a}
            aria-label={ACCENT_LABELS[a]}
            title={ACCENT_LABELS[a]}
            onClick={() => onChange(a)}
            className={cn(
              "h-7 rounded-full border-2 border-background ring-1 ring-border transition-shadow",
              a === "theme" ? "bg-muted px-2.5 text-xs" : "w-7",
              value === a && "ring-2 ring-foreground",
            )}
            // The swatch shows the shade this mode would use (globals.css).
            style={a === "theme" ? undefined : { background: `var(--accent-${a})` }}
          >
            {a === "theme" ? "Theme" : null}
          </button>
        ))}
      </div>
    </div>
  );
}

const BACKGROUND_LABELS: Record<Background, string> = {
  plain: "Plain",
  grain: "Paper grain",
  dots: "Dots",
  lines: "Ruled lines",
  grid: "Graph paper",
  linen: "Linen",
  games: "Controllers",
  waves: "Waves",
  glow: "Glow",
  contours: "Contours",
  stars: "Starry night",
  leaves: "Leaves",
  scallops: "Scallops",
  parquet: "Parquet",
  aurora: "Aurora",
  trellis: "Trellis",
  quatrefoil: "Quatrefoil",
  asanoha: "Hemp leaf",
  terrazzo: "Terrazzo",
  marble: "Marble",
  leather: "Leather",
  ricepaper: "Rice paper",
  letterpress: "Letterpress",
  rain: "Rain",
  ripples: "Ripples",
  snow: "Snow",
  sky: "Sky",
};

/** The background textures as small previews of the page, one button
 *  each. A swatch is drawn by the same CSS as the page (globals.css). */
function BackgroundPicker({
  value,
  onChange,
}: {
  value: Background;
  onChange: (b: Background) => void;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[14rem_1fr] sm:items-start sm:gap-4">
      <div>
        <p className="text-sm font-medium">Background</p>
        <p className="text-xs text-muted-foreground">
          Behind the pages, not the cards on them. Rain, snow, stars, aurora and
          ripples move gently. Sky follows the time of day where you are.
        </p>
      </div>
      <div role="radiogroup" aria-label="Background" className="flex flex-wrap gap-2">
        {BACKGROUNDS.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={value === b}
            onClick={() => onChange(b)}
            className="group grid w-16 justify-items-center gap-1 text-[11px] text-muted-foreground"
          >
            <span
              className={cn(
                "texture-swatch h-11 w-16 rounded-md border ring-offset-2 ring-offset-background transition-shadow group-hover:border-ring/60",
                value === b && "ring-2 ring-foreground",
              )}
              data-texture={b}
              aria-hidden="true"
            />
            <span className={cn("leading-tight", value === b && "font-medium text-foreground")}>
              {BACKGROUND_LABELS[b]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const STATS_LABELS: Record<HideableStat, string> = {
  goal: "Play goal",
  heatmap: "Play days calendar",
  perYear: "Games and hours per year",
  mostPlayed: "Most played",
  tags: "Genres & tags",
  platforms: "Platforms",
  formats: "Formats",
};

/** "+30 min and +1 h": the two quick-log buttons a choice gives, worded as
 *  the buttons themselves are. */
const QUICK_LOG_OPTIONS = QUICK_LOG_STEPS.map((value) => ({
  value,
  label: stepsFor(value)
    .map((step) => step.label)
    .join(" and "),
}));

/** "Standard (30 min, 1 h, 2 h)": each named calendar scale with the time a
 *  day each darker shade starts at. */
function heatmapOption(value: keyof typeof HEATMAP_STEPS, name: string) {
  return { value, label: `${name} (${HEATMAP_STEPS[value].map(formatPlaytime).join(", ")})` };
}

/** A labelled dropdown row. */
function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="w-full sm:w-72" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A checkbox with its label. */
function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  /** For links straight to the section (/account#pick-for-me). */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="grid scroll-mt-20 gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * The Preferences card on the Account page. Every change saves straight
 * away (only the setting that changed is sent) and the page refreshes, so
 * the rest of the app picks it up on the next screen.
 */
export function PreferencesForm({
  initial,
  serverTimeZone,
  timeZones,
  igdbAvailable,
  savedViews,
}: {
  /** As stored: `timeZone` is "" while the server's zone is in use. */
  initial: Preferences;
  serverTimeZone: string;
  /** Every zone this server knows, for the time zone list. */
  timeZones: string[];
  /** Whether this server has IGDB keys (IGDB_CLIENT_ID and
   *  IGDB_CLIENT_SECRET). Without them IGDB isn't searched whatever the
   *  setting says, so it isn't offered. */
  igdbAvailable: boolean;
  savedViews: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [, startTransition] = useTransition();

  function update(patch: Partial<Preferences>) {
    setPrefs((p) => ({ ...p, ...patch }));
    for (const [key, value] of Object.entries(patch)) {
      const attribute = HTML_ATTRIBUTES[key as keyof Preferences];
      if (attribute) document.documentElement.setAttribute(attribute, String(value));
    }
    setStatus("saving");
    startTransition(async () => {
      try {
        await savePreferences(patch);
        setStatus("saved");
        router.refresh();
      } catch {
        setStatus("error");
      }
    });
  }

  function toggleIn<T extends string>(list: T[], item: T, on: boolean): T[] {
    return on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);
  }

  // Catalogues: the enabled ones in priority order, then the rest.
  const offered = CATALOGUES.filter((c) => c !== "igdb" || igdbAvailable);
  const enabled = prefs.catalogues.filter((c) => offered.includes(c));
  const catalogueRows = [...enabled, ...offered.filter((c) => !enabled.includes(c))];

  function moveCatalogue(c: Catalogue, by: -1 | 1) {
    const list = [...enabled];
    const i = list.indexOf(c);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    // Keep an unavailable IGDB in the list (last), so it comes back on if
    // this server gets its keys later.
    update({ catalogues: [...list, ...prefs.catalogues.filter((x) => !offered.includes(x))] });
  }

  const zone = prefs.timeZone || serverTimeZone;
  const zoneOptions = timeZones.includes(zone) ? timeZones : [zone, ...timeZones];

  // Saved views in the player's order, which moving one changes at once.
  const views = orderByIds(savedViews, prefs.savedViewOrder);
  const shownStatusTabs = Object.values(PlayStatus).filter(
    (s) => !prefs.hiddenStatusTabs.includes(s),
  ).length;

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {status === "saving"
          ? "Saving…"
          : status === "saved"
            ? "Saved."
            : status === "error"
              ? "Couldn't save that change. Try again."
              : "Changes save as you make them."}
      </p>

      <Section title="New games" id="new-games">
        <Choice
          label="Format"
          value={prefs.newGameFormat}
          options={Object.values(GameFormat).map((f) => ({ value: f, label: FORMAT_LABELS[f] }))}
          onChange={(v) => update({ newGameFormat: v })}
        />
        <Choice
          label="Status"
          value={prefs.newGameStatus}
          options={Object.values(PlayStatus).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          onChange={(v) => update({ newGameStatus: v })}
        />
        <Choice
          label="Ownership"
          value={prefs.newGameOwnership}
          options={Object.values(GameOwnership).map((o) => ({
            value: o,
            label: OWNERSHIP_LABELS[o],
          }))}
          onChange={(v) => update({ newGameOwnership: v })}
        />
        <Choice
          label="Games I add as Completed were finished"
          hint="Bulk edit's Set status: Completed follows this too."
          value={prefs.addedAsCompletedFinished}
          options={[
            { value: "today", label: "Today" },
            { value: "undated", label: "No date, unless I pick one" },
          ]}
          onChange={(v) => update({ addedAsCompletedFinished: v })}
        />
        <Choice
          label="After adding a game"
          value={prefs.afterAdd}
          options={[
            { value: "open", label: "Open the game" },
            { value: "another", label: "Add another" },
            { value: "library", label: "Go to the library" },
          ]}
          onChange={(v) => update({ afterAdd: v })}
        />
        <Choice
          label="Copy genres from the catalogue as tags"
          value={prefs.importTagsMode}
          options={[
            { value: "off", label: "Off" },
            { value: "known", label: "Only tags I already use" },
            { value: "all", label: "All of them" },
          ]}
          onChange={(v) => update({ importTagsMode: v })}
        />
        {/* From the server's copy, not this form's state: rules are added
            elsewhere (Manage tags) and removed through their own action. */}
        <TagRulesList renames={initial.tagRenames} skips={initial.tagSkips} />
      </Section>

      <Section title="Game search">
        <p className="text-xs text-muted-foreground">
          Which catalogues to search when adding a game, and which comes first.
          {!igdbAvailable &&
            " IGDB shows up here once the server has IGDB_CLIENT_ID and IGDB_CLIENT_SECRET set."}
        </p>
        <ul className="grid gap-1.5">
          {catalogueRows.map((c) => {
            const on = enabled.includes(c);
            const i = enabled.indexOf(c);
            return (
              <li key={c} className="flex items-center gap-2">
                <Toggle
                  label={CATALOGUE_LABELS[c]}
                  checked={on}
                  // At least one catalogue stays on.
                  disabled={on && enabled.length === 1}
                  onChange={(checked) =>
                    update({
                      catalogues: checked
                        ? [...prefs.catalogues, c]
                        : prefs.catalogues.filter((x) => x !== c),
                    })
                  }
                />
                {on && enabled.length > 1 && (
                  <span className="ml-auto flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Search earlier"
                      disabled={i === 0}
                      onClick={() => moveCatalogue(c, -1)}
                    >
                      <ArrowUp data-slot="icon" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Search later"
                      disabled={i === enabled.length - 1}
                      onClick={() => moveCatalogue(c, 1)}
                    >
                      <ArrowDown data-slot="icon" />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Playing">
        <Choice
          label="Step buttons"
          hint="The two buttons next to the time box on a game you're playing."
          value={prefs.quickLogSteps}
          options={QUICK_LOG_OPTIONS}
          onChange={(v) => update({ quickLogSteps: v })}
        />
        <Choice
          label="Pace from"
          hint="Used for your time a day, and for when you'll reach a game's usual time to beat."
          value={prefs.paceFrom}
          options={[
            { value: "playthrough", label: "The whole playthrough" },
            { value: "7d", label: "The last 7 days" },
            { value: "14d", label: "The last 14 days" },
          ]}
          onChange={(v) => update({ paceFrom: v })}
        />
      </Section>

      <Section title="Dates and numbers">
        <Choice
          label="Dates"
          value={prefs.dateFormat}
          options={DATE_FORMATS.map((f) => ({ value: f, label: formatDayKey("2024-05-12", f) }))}
          onChange={(v) => update({ dateFormat: v })}
        />
        <Choice
          label="Numbers"
          value={prefs.numberFormat}
          options={NUMBER_FORMATS.map((f) => ({
            value: f,
            label: formatNumber(12345, { numberFormat: f }),
          }))}
          onChange={(v) => update({ numberFormat: v })}
        />
        <Choice
          label="Weeks start on"
          value={prefs.weekStart}
          options={[
            { value: "monday", label: "Monday" },
            { value: "sunday", label: "Sunday" },
          ]}
          onChange={(v) => update({ weekStart: v })}
        />
        <Choice
          label="Time zone"
          hint="Decides which day your play time counts on."
          value={zone}
          options={zoneOptions.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))}
          onChange={(v) => update({ timeZone: v })}
        />
      </Section>

      <Section title="Sorting">
        <Toggle
          label="Ignore “The”, “A” and “An” when sorting titles"
          checked={prefs.ignoreArticles}
          onChange={(c) => update({ ignoreArticles: c })}
        />
        <Choice
          label="Alphabet"
          hint="Where letters like Æ, Ø, Å and Ö sort."
          value={prefs.sortAlphabet}
          options={[
            { value: "en", label: "English" },
            { value: "nb", label: "Norwegian (Æ, Ø, Å after Z)" },
            { value: "da", label: "Danish (Æ, Ø, Å after Z)" },
            { value: "sv", label: "Swedish (Å, Ä, Ö after Z)" },
            { value: "de", label: "German (Ä with A, Ö with O)" },
          ]}
          onChange={(v) => update({ sortAlphabet: v })}
        />
      </Section>

      <Section title="Library" id="library">
        <div className="grid gap-1.5">
          <div>
            <p className="text-sm font-medium">Status tabs to show</p>
            <p className="text-xs text-muted-foreground">The All tab always shows.</p>
          </div>
          {Object.values(PlayStatus).map((s) => {
            const shown = !prefs.hiddenStatusTabs.includes(s);
            return (
              <Toggle
                key={s}
                label={STATUS_LABELS[s]}
                checked={shown}
                // At least one status tab stays.
                disabled={shown && shownStatusTabs === 1}
                onChange={(on) =>
                  update({ hiddenStatusTabs: toggleIn(prefs.hiddenStatusTabs, s, !on) })
                }
              />
            );
          })}
        </div>
        <div role="group" aria-labelledby="search-also-in" className="grid gap-1.5">
          <p id="search-also-in" className="text-sm font-medium">
            Search also looks in
          </p>
          <p className="text-xs text-muted-foreground">
            Title, developer, platform and series are always searched.
          </p>
          {SEARCH_FIELDS.map((field) => (
            <Toggle
              key={field}
              label={SEARCH_FIELD_LABELS[field]}
              checked={prefs.searchAlsoIn.includes(field)}
              onChange={(on) => update({ searchAlsoIn: toggleIn(prefs.searchAlsoIn, field, on) })}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Order and hide shelf chips from Manage shelves in the library.
        </p>
      </Section>

      {savedViews.length > 0 && (
        <SavedViewsList views={views} onReorder={(ids) => update({ savedViewOrder: ids })} />
      )}

      <Section title="Pick for me" id="pick-for-me">
        <Toggle
          label="Only games I have"
          checked={prefs.pickOnlyHave}
          onChange={(c) => update({ pickOnlyHave: c })}
        />
        <Toggle
          label="Only the next game in a series"
          checked={prefs.pickNextInSeries}
          onChange={(c) => update({ pickNextInSeries: c })}
        />
        <p className="text-xs text-muted-foreground">
          Borrowed games count as games you have. Wishlist games, lent-out
          games and ones you no longer have don&apos;t. A Want to Play game in
          a series is skipped while an earlier one is still unplayed.
        </p>
      </Section>

      <Section title="Ratings">
        <Choice
          label="Rate games with"
          value={prefs.ratingStyle}
          options={[
            { value: "half", label: "Half stars" },
            { value: "whole", label: "Whole stars" },
            { value: "ten", label: "A score out of 10" },
            { value: "off", label: "Don't use ratings" },
          ]}
          onChange={(v) => update({ ratingStyle: v })}
        />
      </Section>

      <Section title="Theme">
        <p className="text-sm text-muted-foreground">
          Choose a theme from the palette button in the top bar. Turn on
          “Match system light/dark” there to have it follow your device.
        </p>
      </Section>

      <Section title="Appearance">
        <AccentPicker value={prefs.accent} onChange={(a) => update({ accent: a })} />
        <Choice
          label="Games without a cover"
          value={prefs.coverArt}
          options={[
            { value: "drawn", label: "A drawn cover with the title" },
            { value: "plain", label: "A plain grey box" },
          ]}
          onChange={(v) => update({ coverArt: v })}
        />
        <Choice
          label="Corners"
          value={prefs.corners}
          options={[
            { value: "square", label: "Square" },
            { value: "rounded", label: "Rounded" },
            { value: "round", label: "Round" },
          ]}
          onChange={(v) => update({ corners: v })}
        />
        <Choice
          label="Cards"
          hint="Frosted lets the background show through, softly blurred."
          value={prefs.cardStyle}
          options={[
            { value: "flat", label: "Flat, with a thin outline" },
            { value: "raised", label: "Raised, with a soft shadow" },
            { value: "frosted", label: "Frosted glass" },
          ]}
          onChange={(v) => update({ cardStyle: v })}
        />
        <BackgroundPicker value={prefs.background} onChange={(b) => update({ background: b })} />
        <Choice
          label="Behind a game's page"
          value={prefs.gameBackdrop}
          options={[
            { value: "cover", label: "A soft wash of its cover's colours" },
            { value: "plain", label: "Nothing" },
          ]}
          onChange={(v) => update({ gameBackdrop: v })}
        />
      </Section>

      <Section title="Motion">
        <Choice
          label="Animations"
          hint="Always off when your device asks for reduced motion."
          value={prefs.motion}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          onChange={(v) => update({ motion: v })}
        />
        <Choice
          label="Moving backgrounds"
          hint="Falling rain and snow, twinkling stars, drifting aurora and ripples."
          value={prefs.backgroundMotion}
          options={[
            { value: "moving", label: "On" },
            { value: "still", label: "Off, keep them still" },
          ]}
          onChange={(v) => update({ backgroundMotion: v })}
        />
      </Section>

      <Section title="Text">
        <Choice
          label="Text size"
          value={prefs.textSize}
          options={[
            { value: "normal", label: "Normal" },
            { value: "large", label: "Large" },
            { value: "larger", label: "Larger" },
          ]}
          onChange={(v) => update({ textSize: v })}
        />
        <Choice
          label="Font for long text"
          hint="Descriptions, reviews and notes."
          value={prefs.longTextFont}
          options={[
            { value: "sans", label: "Same as everything else" },
            { value: "serif", label: "Serif" },
          ]}
          onChange={(v) => update({ longTextFont: v })}
        />
        <Choice
          label="Headings"
          hint="Page titles, game titles and card titles."
          value={prefs.headingFont}
          options={[
            { value: "sans", label: "Same as everything else" },
            { value: "serif", label: "Serif" },
            { value: "rounded", label: "Rounded" },
          ]}
          onChange={(v) => update({ headingFont: v })}
        />
      </Section>

      <Section title="Pages and navigation">
        <Choice
          label="Start page"
          hint="Where the app opens, and where the logo goes."
          value={prefs.startPage}
          options={[
            { value: "library", label: "Library" },
            { value: "stats", label: "Stats" },
            { value: "add", label: "Add game" },
            { value: "playing", label: "Now playing" },
          ]}
          onChange={(v) => update({ startPage: v })}
        />
        {savedViews.length > 0 && (
          <Choice
            label="Library opens on"
            value={
              savedViews.some((v) => v.id === prefs.defaultViewId) ? prefs.defaultViewId : "none"
            }
            options={[
              { value: "none", label: "The whole library" },
              ...views.map((v) => ({ value: v.id, label: `Saved view: ${v.name}` })),
            ]}
            onChange={(v) => update({ defaultViewId: v === "none" ? "" : v })}
          />
        )}
        <div className="grid gap-1.5">
          <p className="text-sm font-medium">Show in the top bar</p>
          {/* The game room has its own section, below. */}
          {HIDEABLE_NAV.filter((item) => item !== "room").map((item) => (
            <Toggle
              key={item}
              label={NAV_LABELS[item]}
              checked={!prefs.hiddenNav.includes(item)}
              onChange={(shown) => update({ hiddenNav: toggleIn(prefs.hiddenNav, item, !shown) })}
            />
          ))}
        </div>
      </Section>

      <Section title="Game room" id="game-room">
        <div className="grid gap-1">
          <Toggle
            label="The game room"
            checked={!prefs.hiddenNav.includes("room")}
            onChange={(on) => update({ hiddenNav: toggleIn(prefs.hiddenNav, "room", !on) })}
          />
          <p className="pl-6 text-xs text-muted-foreground">
            Your games as a pixel-art house, with an avatar who lives there. Turned off, the Room tab goes away.
          </p>
        </div>
        {!prefs.hiddenNav.includes("room") && (
          <Toggle
            label="Show my avatar in the room"
            checked={prefs.avatarShown}
            onChange={(avatarShown) => update({ avatarShown })}
          />
        )}
      </Section>

      <Section title="Game page" id="game-page">
        <GamePageCardList prefs={prefs} update={update} />
        <Choice
          label="Long descriptions"
          value={prefs.gameDescription}
          options={[
            { value: "full", label: "In full" },
            { value: "clamp", label: "First 4 lines, with More" },
          ]}
          onChange={(v) => update({ gameDescription: v })}
        />
        <Choice
          label="Shelves card"
          hint="What the Shelves card lists on a game."
          value={prefs.shelvesCard}
          options={[
            { value: "all", label: "Every shelf" },
            { value: "mine", label: "Only this game's shelves, plus Add" },
          ]}
          onChange={(v) => update({ shelvesCard: v })}
        />
        <FindLinksEditor prefs={prefs} update={update} />
      </Section>

      <Section title="Stats page">
        <div className="grid gap-1.5">
          <p className="text-sm font-medium">Show these cards</p>
          {HIDEABLE_STATS.map((card) => (
            <Toggle
              key={card}
              label={STATS_LABELS[card]}
              checked={!prefs.hiddenStats.includes(card)}
              onChange={(shown) =>
                update({ hiddenStats: toggleIn(prefs.hiddenStats, card, !shown) })
              }
            />
          ))}
        </div>
        <Choice
          label="Calendar shading"
          hint="Time played a day for each shade of the play calendar."
          value={prefs.heatmapScale}
          options={[
            heatmapOption("standard", "Standard"),
            heatmapOption("gentle", "Gentle"),
            heatmapOption("heavy", "Heavy"),
            { value: "auto", label: "Based on my usual day" },
          ]}
          onChange={(v) => update({ heatmapScale: v })}
        />
        <Choice
          label="Stats open on"
          hint="The buttons on the Stats page switch it any time."
          value={prefs.statsPeriod}
          options={STATS_PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
          onChange={(v) => update({ statsPeriod: v })}
        />
        <Choice
          label="Genres, Platforms and Formats count"
          value={prefs.statsBreakdown}
          options={[
            { value: "library", label: "Every game in the library" },
            { value: "period", label: "Games I completed in the period" },
          ]}
          onChange={(v) => update({ statsBreakdown: v })}
        />
        {/* Linked from the goal card's "Change what counts". */}
        <div
          id="what-counts"
          role="group"
          aria-labelledby="what-counts-heading"
          className="grid scroll-mt-20 gap-3"
        >
          <div>
            <p id="what-counts-heading" className="text-sm font-medium">
              What counts
            </p>
            <p className="text-xs text-muted-foreground">
              Used by the stats cards, your play goal and the year in review.
            </p>
          </div>
          <Choice
            label="Hours played count"
            hint="Games you complete without logging still add their whole time played."
            value={prefs.statsHoursPlayed}
            options={[
              { value: "logged", label: "The time I log, on the day I play" },
              { value: "finished", label: "A game's whole time, when I complete it" },
            ]}
            onChange={(v) => update({ statsHoursPlayed: v })}
          />
          <Choice
            label="Games I drop"
            value={prefs.statsStoppedGames}
            options={[
              { value: "none", label: "Don't count" },
              { value: "hours", label: "Count the hours I played" },
              { value: "game", label: "Count as a game" },
            ]}
            onChange={(v) => update({ statsStoppedGames: v })}
          />
        </div>
      </Section>
    </div>
  );
}

/** Saved library views: rename, reorder (the chips above the library
 *  follow this order) or delete. Views are saved from the library's filter
 *  bar. */
function SavedViewsList({
  views,
  onReorder,
}: {
  /** In the player's order. */
  views: { id: string; name: string }[];
  /** Saves a new order, through the form's own save and status line. */
  onReorder: (ids: string[]) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A deleted view leaves the list at once, so focus can go to the next.
  const [gone, setGone] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  const rows = views.filter((v) => !gone.includes(v.id));

  /** Focus the first of `selectors` that is there and enabled, once React
   *  has redrawn the list: a moved or removed row takes the focus with it
   *  otherwise. */
  function focusSoon(...selectors: string[]) {
    requestAnimationFrame(() => {
      for (const selector of selectors) {
        const el = listRef.current?.querySelector<HTMLButtonElement>(selector);
        if (el && !el.disabled) {
          el.focus();
          return;
        }
      }
    });
  }

  function cancel(id: string) {
    setEditing(null);
    setError(null);
    focusSoon(`[data-rename="${id}"]`);
  }

  function submitRename(view: { id: string; name: string }) {
    const to = newName.trim();
    if (!to || to === view.name) {
      cancel(view.id);
      return;
    }
    startTransition(async () => {
      const res = await renameView(view.id, to);
      if (res.error) {
        setError(res.error);
        return;
      }
      cancel(view.id);
      router.refresh();
    });
  }

  function move(view: { id: string }, by: -1 | 1) {
    onReorder(
      moveId(
        rows.map((v) => v.id),
        view.id,
        by,
      ),
    );
    focusSoon(`[data-move="${view.id}:${by}"]`, `[data-move="${view.id}:${-by}"]`);
  }

  function remove(view: { id: string }) {
    const i = rows.findIndex((v) => v.id === view.id);
    const neighbour = rows[i + 1] ?? rows[i - 1];
    startTransition(async () => {
      await deleteView(view.id);
      setGone((g) => [...g, view.id]);
      if (neighbour) focusSoon(`[data-rename="${neighbour.id}"]`);
      router.refresh();
    });
  }

  return (
    <Section title="Saved views">
      <ul ref={listRef} className="grid gap-1">
        {rows.map((v, i) => (
          <li key={v.id} className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {editing === v.id ? (
              <form
                className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitRename(v);
                }}
              >
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancel(v.id);
                    }
                  }}
                  maxLength={SAVED_VIEW_NAME_MAX}
                  autoFocus
                  aria-label={`New name for “${v.name}”`}
                  className="h-8 min-w-0 flex-1 basis-40"
                />
                <span className="flex gap-1">
                  <Button type="submit" size="sm" disabled={pending}>
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => cancel(v.id)}>
                    Cancel
                  </Button>
                </span>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-rename={v.id}
                    title="Rename"
                    aria-label={`Rename “${v.name}”`}
                    onClick={() => {
                      setEditing(v.id);
                      setNewName(v.name);
                      setError(null);
                    }}
                  >
                    <Pencil data-slot="icon" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-move={`${v.id}:-1`}
                    title="Move up"
                    aria-label={`Move “${v.name}” up`}
                    disabled={i === 0}
                    onClick={() => move(v, -1)}
                  >
                    <ArrowUp data-slot="icon" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-move={`${v.id}:1`}
                    title="Move down"
                    aria-label={`Move “${v.name}” down`}
                    disabled={i === rows.length - 1}
                    onClick={() => move(v, 1)}
                  >
                    <ArrowDown data-slot="icon" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={`Delete “${v.name}”`}
                    aria-label={`Delete “${v.name}”`}
                    disabled={pending}
                    onClick={() => remove(v)}
                  >
                    <Trash2 data-slot="icon" />
                  </Button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="text-sm text-destructive">
        {error}
      </p>
    </Section>
  );
}
