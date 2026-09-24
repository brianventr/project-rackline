import { describe, expect, it } from "vitest";
import {
  FLOW_STAGES,
  TOUR_STEPS,
  TOUR_VERSION,
  flowStagesFor,
  shouldAutoOpenTour,
  tourAudience,
  tourSeenKey,
  tourStepBody,
  tourStepIndex,
  tourStepsFor,
} from "./tour";
import { garageAllowsPath } from "./operating-mode";

describe("tour steps", () => {
  it("gives owners the office story and operators the floor story, both ending on a next step", () => {
    expect(tourStepsFor({ role: "owner" }).map((step) => step.id)).toEqual([
      "welcome",
      "hierarchy",
      "flow",
      "workspaces",
      "modes",
      "finish",
    ]);
    expect(tourStepsFor({ role: "operator" }).map((step) => step.id)).toEqual(["welcome", "hierarchy", "floor", "finish"]);
    expect(tourStepsFor({ role: null }).map((step) => step.id)).toEqual(["welcome", "hierarchy", "floor", "finish"]);
  });

  it("has exactly one finish step per audience and never two of the same id in a list", () => {
    for (const role of ["owner", "operator"]) {
      const ids = tourStepsFor({ role }).map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[ids.length - 1]).toBe("finish");
    }
  });

  it("writes plain paragraphs with no exclamation marks", () => {
    for (const step of TOUR_STEPS) {
      for (const text of [step.eyebrow, step.title, ...step.body, ...(step.garageBody ?? [])]) {
        expect(text, step.id).not.toMatch(/!/);
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
      }
      expect(step.body.length).toBeGreaterThan(0);
      if (step.garageBody) expect(step.garageBody.length).toBe(step.body.length);
    }
  });

  it("swaps in Garage Mode words only where a step has them", () => {
    const flow = TOUR_STEPS.find((step) => step.id === "flow")!;
    expect(tourStepBody(flow, { garage: true })).toBe(flow.garageBody);
    expect(tourStepBody(flow, { garage: false })).toBe(flow.body);
    const welcome = TOUR_STEPS.find((step) => step.id === "welcome")!;
    expect(tourStepBody(welcome, { garage: true })).toBe(welcome.body);
  });

  it("finds a step's place, and starts at the top for a step this person does not have", () => {
    const steps = tourStepsFor({ role: "owner" });
    expect(tourStepIndex(steps, "flow")).toBe(2);
    expect(tourStepIndex(steps, "floor")).toBe(0);
    expect(tourStepIndex(steps, null)).toBe(0);
  });

  it("maps roles onto an audience", () => {
    expect(tourAudience("owner")).toBe("owner");
    expect(tourAudience("operator")).toBe("operator");
    expect(tourAudience(undefined)).toBe("operator");
  });
});

describe("flow stages", () => {
  it("walks inbound, stock, make, outbound with pages Garage Mode can open", () => {
    expect(FLOW_STAGES.map((stage) => stage.id)).toEqual(["inbound", "stock", "make", "outbound"]);
    for (const stage of FLOW_STAGES) {
      expect(garageAllowsPath(stage.path), stage.id).toBe(true);
      expect(stage.stops.length).toBeGreaterThan(0);
      for (const stop of stage.stops) expect(stop.note).not.toMatch(/!/);
    }
  });

  it("drops Manufacturer-only stops and uses bench words in Garage Mode", () => {
    const garage = flowStagesFor({ garage: true });
    expect(garage.map((stage) => stage.title)).toEqual(["Parts", "Shelf", "Build", "Ship"]);
    expect(garage.find((stage) => stage.id === "stock")!.stops.map((stop) => stop.verb)).toEqual(["Adjust"]);
    const full = flowStagesFor({ garage: false });
    expect(full.map((stage) => stage.title)).toEqual(["Inbound", "Stock", "Make", "Outbound"]);
    expect(full.find((stage) => stage.id === "stock")!.stops.map((stop) => stop.verb)).toEqual([
      "Count",
      "Hold",
      "Replenish",
      "Adjust",
    ]);
  });
});

describe("shouldAutoOpenTour", () => {
  const loaded = { loaded: true, incomplete: true };

  it("opens once for a new owner on Today while the shop is still being set up", () => {
    expect(shouldAutoOpenTour({ seen: false, role: "owner", pathname: "/today", onboarding: loaded })).toBe(true);
    expect(shouldAutoOpenTour({ seen: false, role: "owner", pathname: "/today/", onboarding: loaded })).toBe(true);
  });

  it("never opens twice, or off the home screen, or before the checklist has loaded", () => {
    expect(shouldAutoOpenTour({ seen: true, role: "owner", pathname: "/today", onboarding: loaded })).toBe(false);
    expect(shouldAutoOpenTour({ seen: false, role: "owner", pathname: "/stock/items", onboarding: loaded })).toBe(false);
    expect(shouldAutoOpenTour({ seen: false, role: "owner", pathname: "/floor", onboarding: loaded })).toBe(false);
    expect(
      shouldAutoOpenTour({ seen: false, role: "owner", pathname: "/today", onboarding: { loaded: false, incomplete: false } }),
    ).toBe(false);
    expect(shouldAutoOpenTour({ seen: false, role: "owner", pathname: "/today", onboarding: null })).toBe(false);
  });

  it("leaves an owner whose shop already ships alone", () => {
    expect(
      shouldAutoOpenTour({ seen: false, role: "owner", pathname: "/today", onboarding: { loaded: true, incomplete: false } }),
    ).toBe(false);
  });

  it("opens once for an operator on the floor, whatever the checklist says", () => {
    expect(shouldAutoOpenTour({ seen: false, role: "operator", pathname: "/floor", onboarding: null })).toBe(true);
    expect(shouldAutoOpenTour({ seen: false, role: "operator", pathname: "/floor?x=1", onboarding: null })).toBe(true);
    expect(shouldAutoOpenTour({ seen: false, role: "operator", pathname: "/floor/pick", onboarding: null })).toBe(false);
    expect(shouldAutoOpenTour({ seen: false, role: "operator", pathname: "/today", onboarding: null })).toBe(false);
    expect(shouldAutoOpenTour({ seen: true, role: "operator", pathname: "/floor", onboarding: null })).toBe(false);
  });

  it("keys the seen flag per org, person, and tour version", () => {
    expect(tourSeenKey("org1", "user1")).toBe(`rackline.tour.seen:org1:user1:v${TOUR_VERSION}`);
    expect(tourSeenKey("org1", "user2")).not.toBe(tourSeenKey("org1", "user1"));
  });
});
