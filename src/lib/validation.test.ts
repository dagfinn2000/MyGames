import { describe, expect, it } from "vitest";
import { gameSchema, isAllowedCoverUrl, pastPlaythroughSchema, playSchema } from "@/lib/validation";

const minimalForm = {
  title: "T",
  authors: "",
  tags: "",
  format: "PHYSICAL",
  ownership: "OWNED",
};

describe("gameSchema tags", () => {
  it("splits, trims, and lowercases the comma-separated field", () => {
    const parsed = gameSchema.parse({
      ...minimalForm,
      tags: " Fantasy , Sci-Fi ,",
    });
    expect(parsed.tags).toEqual(["fantasy", "sci-fi"]);
  });

  it("dedupes tags that collide after lowercasing", () => {
    // Metadata subjects often differ only in case — "Fiction, fiction"
    // must not land twice (duplicate React keys on the game page).
    const parsed = gameSchema.parse({
      ...minimalForm,
      tags: "Fiction, fiction, FICTION, fantasy",
    });
    expect(parsed.tags).toEqual(["fiction", "fantasy"]);
  });
});

describe("isAllowedCoverUrl", () => {
  it("accepts local cache paths, http(s) URLs and an empty value", () => {
    for (const url of ["", "/api/covers/abc-1234.jpg", "https://covers.openlibrary.org/b/id/1-L.jpg", "HTTP://x.example/a.png"]) {
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
  it("saves a blank length as not known", () => {
    expect(gameSchema.parse({ ...minimalForm, lengthMinutes: "" }).lengthMinutes).toBeNull();
    expect(gameSchema.parse(minimalForm).lengthMinutes).toBeUndefined();
    expect(gameSchema.parse({ ...minimalForm, lengthMinutes: "700" }).lengthMinutes).toBe(700);
  });

  it("reports a length out of range instead of dropping it", () => {
    const zero = gameSchema.safeParse({ ...minimalForm, lengthMinutes: "0" });
    expect(zero.error?.issues[0]?.message).toBe("Length must be at least 1 minute");
    const huge = gameSchema.safeParse({ ...minimalForm, lengthMinutes: "60001" });
    expect(huge.error?.issues[0]?.message).toBe("Length must be at most 1,000 hours");
  });
});

describe("reading dates", () => {
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

  it("applies the same rules to past reads", () => {
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
    expect(pastPlaythroughSchema.parse({ note: "  Read it aloud to the kids \n" }).note).toBe(
      "Read it aloud to the kids",
    );
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
