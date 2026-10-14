import { describe, expect, it } from "vitest";
import {
  gameSchema,
  isAllowedCoverUrl,
  pastPlaythroughSchema,
  playSchema,
  quoteSchema,
} from "@/lib/validation";

const minimalForm = {
  title: "T",
  developers: "",
  tags: "",
  format: "PHYSICAL",
  ownership: "OWNED",
};

describe("gameSchema developers", () => {
  it("splits and trims the comma-separated field, dropping blanks", () => {
    const parsed = gameSchema.parse({
      ...minimalForm,
      developers: " Valve , Hidden Path Entertainment ,",
    });
    expect(parsed.developers).toEqual(["Valve", "Hidden Path Entertainment"]);
    expect(gameSchema.parse(minimalForm).developers).toEqual([]);
  });
});

describe("gameSchema publisher and platform", () => {
  it("trims them, and saves a blank one as none", () => {
    const parsed = gameSchema.parse({
      ...minimalForm,
      publisher: "  Nintendo ",
      platform: " Nintendo Switch ",
    });
    expect(parsed.publisher).toBe("Nintendo");
    expect(parsed.platform).toBe("Nintendo Switch");

    const blank = gameSchema.parse({ ...minimalForm, publisher: "  ", platform: "" });
    expect(blank.publisher).toBeNull();
    expect(blank.platform).toBeNull();
    expect(gameSchema.parse(minimalForm).platform).toBeUndefined();
  });

  it("refuses ones that are too long", () => {
    expect(gameSchema.parse({ ...minimalForm, platform: "x".repeat(100) }).platform).toHaveLength(100);
    const platform = gameSchema.safeParse({ ...minimalForm, platform: "x".repeat(101) });
    expect(platform.error?.issues[0]?.message).toBe("Platform must be at most 100 characters");

    expect(gameSchema.parse({ ...minimalForm, publisher: "x".repeat(200) }).publisher).toHaveLength(200);
    const publisher = gameSchema.safeParse({ ...minimalForm, publisher: "x".repeat(201) });
    expect(publisher.error?.issues[0]?.message).toBe("Publisher must be at most 200 characters");
  });
});

describe("gameSchema releaseDate", () => {
  it("keeps partial dates as written and caps the length", () => {
    for (const date of ["1998", "2017-03", "2017-03-03"]) {
      expect(gameSchema.parse({ ...minimalForm, releaseDate: date }).releaseDate).toBe(date);
    }
    expect(gameSchema.parse({ ...minimalForm, releaseDate: " " }).releaseDate).toBeNull();
    expect(gameSchema.safeParse({ ...minimalForm, releaseDate: "x".repeat(21) }).success).toBe(false);
  });
});

describe("gameSchema catalogueId", () => {
  it("accepts the three catalogues' ids, and blank as none", () => {
    for (const id of ["igdb:portal-2", "steam:620", "wikidata:Q279744"]) {
      expect(gameSchema.parse({ ...minimalForm, catalogueId: id }).catalogueId).toBe(id);
    }
    expect(gameSchema.parse({ ...minimalForm, catalogueId: " steam:620 " }).catalogueId).toBe(
      "steam:620",
    );
    expect(gameSchema.parse({ ...minimalForm, catalogueId: "" }).catalogueId).toBeNull();
    expect(gameSchema.parse(minimalForm).catalogueId).toBeUndefined();
  });

  it("refuses anything else", () => {
    // A bare id, an unknown catalogue, a prefix with nothing after it, a
    // space inside, and the wrong case.
    for (const id of ["OL27482W", "gog:hollow_knight", "igdb:", "steam:6 20", "IGDB:portal-2"]) {
      const res = gameSchema.safeParse({ ...minimalForm, catalogueId: id });
      expect(res.success, id).toBe(false);
      expect(res.error?.issues[0]?.message).toBe("That isn't a catalogue id MyGames knows");
    }
    const long = gameSchema.safeParse({ ...minimalForm, catalogueId: `igdb:${"x".repeat(200)}` });
    expect(long.success).toBe(false);
  });
});

describe("gameSchema tags", () => {
  it("splits, trims, and lowercases the comma-separated field", () => {
    const parsed = gameSchema.parse({
      ...minimalForm,
      tags: " Metroidvania , Soulslike ,",
    });
    expect(parsed.tags).toEqual(["metroidvania", "soulslike"]);
  });

  it("dedupes tags that collide after lowercasing", () => {
    // Catalogue genres often differ only in case — "RPG, rpg" must not
    // land twice (duplicate React keys on the game page).
    const parsed = gameSchema.parse({
      ...minimalForm,
      tags: "RPG, rpg, Rpg, platformer",
    });
    expect(parsed.tags).toEqual(["rpg", "platformer"]);
  });
});

describe("isAllowedCoverUrl", () => {
  it("accepts local cache paths, http(s) URLs and an empty value", () => {
    for (const url of [
      "",
      "/api/covers/abc-1234.jpg",
      "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1rgi.jpg",
      "HTTP://x.example/a.png",
    ]) {
      expect(isAllowedCoverUrl(url), url).toBe(true);
    }
  });

  it("refuses other schemes and protocol-relative paths", () => {
    // `//host` and `/\host` start with "/" but browsers fetch them off-site.
    for (const url of ["javascript:alert(1)", "data:image/png;base64,AAAA", "//evil.example/x.jpg", "/\\evil.example/x.jpg", "ftp://x.example/a.jpg"]) {
      expect(isAllowedCoverUrl(url), url).toBe(false);
    }
  });
});

describe("gameSchema seriesNumber", () => {
  it("saves a blank field as no number, not #0", () => {
    expect(gameSchema.parse({ ...minimalForm, seriesNumber: "" }).seriesNumber).toBeNull();
    expect(gameSchema.parse({ ...minimalForm, seriesNumber: "  " }).seriesNumber).toBeNull();
    expect(gameSchema.parse(minimalForm).seriesNumber).toBeUndefined();
  });

  it("keeps real numbers, including a deliberate 0 and halves", () => {
    expect(gameSchema.parse({ ...minimalForm, seriesNumber: "0" }).seriesNumber).toBe(0);
    expect(gameSchema.parse({ ...minimalForm, seriesNumber: "2.5" }).seriesNumber).toBe(2.5);
  });
});

describe("gameSchema lengthMinutes", () => {
  it("saves a blank time to beat as not known", () => {
    expect(gameSchema.parse({ ...minimalForm, lengthMinutes: "" }).lengthMinutes).toBeNull();
    expect(gameSchema.parse(minimalForm).lengthMinutes).toBeUndefined();
    expect(gameSchema.parse({ ...minimalForm, lengthMinutes: "2400" }).lengthMinutes).toBe(2400);
  });

  it("keeps a time to beat whatever the format", () => {
    for (const format of ["PHYSICAL", "DIGITAL", "SUBSCRIPTION"]) {
      expect(gameSchema.parse({ ...minimalForm, format, lengthMinutes: "600" }).lengthMinutes).toBe(600);
    }
  });

  it("reports a time to beat out of range instead of dropping it", () => {
    const zero = gameSchema.safeParse({ ...minimalForm, lengthMinutes: "0" });
    expect(zero.error?.issues[0]?.message).toBe("Time to beat must be at least 1 minute");
    const huge = gameSchema.safeParse({ ...minimalForm, lengthMinutes: "60001" });
    expect(huge.error?.issues[0]?.message).toBe("Time to beat must be at most 1,000 hours");
    const part = gameSchema.safeParse({ ...minimalForm, lengthMinutes: "90.5" });
    expect(part.error?.issues[0]?.message).toBe("Time to beat must be whole minutes");
  });
});

describe("time played", () => {
  const played = (text: string) =>
    playSchema.parse({ status: "PLAYING", playedMinutes: text }).playedMinutes;

  it("reads the time as typed into minutes", () => {
    expect(played("12:30")).toBe(750);
    expect(played("12h 30m")).toBe(750);
    expect(played("45 min")).toBe(45);
    expect(played("90")).toBe(90);
    expect(played(" 3h ")).toBe(180);
    expect(played("1,5 h")).toBe(90);
  });

  it("saves blank or zero as none, and leaves an unsent field undefined", () => {
    expect(played("")).toBeNull();
    expect(played("  ")).toBeNull();
    expect(played("0:00")).toBeNull();
    // Not sent: updatePlay keeps the time the game already has.
    expect(playSchema.parse({ status: "DROPPED" }).playedMinutes).toBeUndefined();
  });

  it("reports something that isn't a time instead of dropping it", () => {
    const res = playSchema.safeParse({ status: "DROPPED", playedMinutes: "about a week" });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(
      "Couldn't read “about a week”. Type a time, like 12:30, 12h 30m or 45m.",
    );
  });

  it("refuses more than 10,000 hours", () => {
    expect(played("600000")).toBe(600_000);
    const res = playSchema.safeParse({ status: "PLAYING", playedMinutes: "600001" });
    expect(res.error?.issues[0]?.message).toBe("Time played must be at most 10,000 hours");
  });

  it("takes a past playthrough's time the same way", () => {
    expect(pastPlaythroughSchema.parse({ playedMinutes: "42:00" }).playedMinutes).toBe(2520);
    expect(pastPlaythroughSchema.parse({ playedMinutes: "" }).playedMinutes).toBeNull();
    expect(pastPlaythroughSchema.parse({}).playedMinutes).toBeUndefined();
    expect(pastPlaythroughSchema.safeParse({ playedMinutes: "ages" }).success).toBe(false);
  });
});

describe("play dates", () => {
  const dayAfterTomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  it("refuses a finish date before the start date", () => {
    const res = playSchema.safeParse({
      status: "COMPLETED",
      dateStarted: "2026-10-05",
      dateFinished: "2026-10-01",
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe("Finish date is before the start date");
  });

  it("refuses dates in the future", () => {
    expect(playSchema.safeParse({ status: "COMPLETED", dateFinished: dayAfterTomorrow }).success).toBe(false);
    expect(playSchema.safeParse({ status: "PLAYING", dateStarted: dayAfterTomorrow }).success).toBe(false);
  });

  it("accepts the same day for both, and either date alone", () => {
    expect(
      playSchema.safeParse({ status: "COMPLETED", dateStarted: "2026-10-01", dateFinished: "2026-10-01" }).success,
    ).toBe(true);
    expect(playSchema.safeParse({ status: "COMPLETED", dateFinished: "2019-05-01" }).success).toBe(true);
    expect(playSchema.safeParse({ status: "PLAYING", dateStarted: "", dateFinished: "" }).success).toBe(true);
  });

  it("applies the same rules to past playthroughs", () => {
    expect(pastPlaythroughSchema.safeParse({ dateStarted: "2020-02-01", dateFinished: "2020-01-01" }).success).toBe(false);
    expect(pastPlaythroughSchema.safeParse({ dateFinished: "2019-05-01" }).success).toBe(true);
  });

  it("reads a ticked Don't remember box as true and a missing one as false", () => {
    expect(playSchema.parse({ status: "COMPLETED", finishedUnknown: "on" }).finishedUnknown).toBe(true);
    expect(playSchema.parse({ status: "COMPLETED" }).finishedUnknown).toBe(false);
    expect(playSchema.parse({ status: "COMPLETED", finishedUnknown: "" }).finishedUnknown).toBe(false);
  });
});

describe("pastPlaythroughSchema note", () => {
  it("is trimmed", () => {
    expect(pastPlaythroughSchema.parse({ note: "  100%, on hard \n" }).note).toBe("100%, on hard");
  });

  it("is null when empty or only spaces", () => {
    expect(pastPlaythroughSchema.parse({ note: "" }).note).toBeNull();
    expect(pastPlaythroughSchema.parse({ note: "   \n " }).note).toBeNull();
  });

  it("is left undefined when not sent", () => {
    expect(pastPlaythroughSchema.parse({}).note).toBeUndefined();
  });

  it("refuses a note over 2000 characters", () => {
    expect(pastPlaythroughSchema.parse({ note: "x".repeat(2000) }).note).toHaveLength(2000);
    const res = pastPlaythroughSchema.safeParse({ note: "x".repeat(2001) });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe("Keep the note to 2000 characters or fewer.");
  });

  it("still checks the dates when there is a note", () => {
    const res = pastPlaythroughSchema.safeParse({
      dateStarted: "2020-02-01",
      dateFinished: "2020-01-01",
      note: "Second time round",
    });
    expect(res.success).toBe(false);
  });
});

describe("quoteSchema speaker", () => {
  const quote = { text: "It's dangerous to go alone! Take this." };

  it("is trimmed, and none when blank or not sent", () => {
    expect(quoteSchema.parse({ ...quote, speaker: "  Old man " }).speaker).toBe("Old man");
    expect(quoteSchema.parse({ ...quote, speaker: "  " }).speaker).toBeNull();
    expect(quoteSchema.parse(quote).speaker).toBeUndefined();
  });

  it("refuses a speaker over 200 characters", () => {
    expect(quoteSchema.parse({ ...quote, speaker: "x".repeat(200) }).speaker).toHaveLength(200);
    const res = quoteSchema.safeParse({ ...quote, speaker: "x".repeat(201) });
    expect(res.error?.issues[0]?.message).toBe("Speaker must be at most 200 characters");
  });
});
