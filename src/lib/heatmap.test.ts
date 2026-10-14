import { describe, expect, it } from "vitest";
import { heatmapLegend, heatmapLevel, heatmapThresholds } from "@/lib/heatmap";

describe("heatmapThresholds", () => {
  it("uses fixed steps for the named scales", () => {
    expect(heatmapThresholds("standard", [])).toEqual([30, 60, 120]);
    expect(heatmapThresholds("gentle", [500])).toEqual([15, 30, 60]);
    expect(heatmapThresholds("heavy", [])).toEqual([60, 120, 240]);
  });

  it("centres auto on the typical play day", () => {
    // Median of the days played at all is 40 minutes; zero days don't count.
    expect(heatmapThresholds("auto", [0, 0, 10, 40, 40, 90, 200])).toEqual([20, 40, 80]);
  });

  it("rounds auto steps to 5 minutes", () => {
    // Median 97 minutes.
    expect(heatmapThresholds("auto", [60, 97, 180])).toEqual([50, 95, 195]);
  });

  it("keeps auto steps distinct for tiny totals", () => {
    const [a, b, c] = heatmapThresholds("auto", [1, 1, 1]);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("falls back to standard when nothing is played yet", () => {
    expect(heatmapThresholds("auto", [0, 0])).toEqual([30, 60, 120]);
  });
});

describe("heatmapLevel", () => {
  const t = [30, 60, 120] as [number, number, number];

  it("maps minutes played to the five shades", () => {
    expect([0, 5, 30, 59, 60, 119, 120, 400].map((m) => heatmapLevel(m, t))).toEqual([
      0, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it("describes each shade's range", () => {
    expect(heatmapLegend(t)).toEqual([
      "Not played",
      "Under 30 min",
      "30 min to 1 h",
      "1 h to 2 h",
      "2 h or more",
    ]);
  });
});
