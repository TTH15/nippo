import { describe, expect, it } from "vitest";
import { createRibbonFeedback, type RibbonFeedback } from "../ui-preview/ribbon-feedback";

describe("ribbon feedback", () => {
  it("emits once at each movement milestone and on completion", () => {
    const events: RibbonFeedback[] = [];
    const feedback = createRibbonFeedback(kind => events.push(kind), () => true);
    feedback.start(); feedback.move(.11); feedback.move(.13); feedback.move(.3); feedback.move(.3);
    feedback.move(.74); feedback.move(.75); feedback.move(1); feedback.move(.5); feedback.move(.95);
    feedback.release();
    expect(events).toEqual(["grab", "tick", "ready", "release"]);
  });
  it("disables every feedback including release, without scheduling delayed vibration", () => {
    let enabled = false;
    const events: RibbonFeedback[] = [];
    const feedback = createRibbonFeedback(kind => events.push(kind), () => enabled);
    feedback.start(); feedback.move(.5); feedback.move(1); feedback.release();
    expect(events).toEqual([]);
    enabled = true; feedback.start(); enabled = false; feedback.move(1); feedback.release();
    expect(events).toEqual(["grab"]);
  });
});
