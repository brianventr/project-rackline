import { describe, expect, it } from "vitest";
import { isEmailAddress, purchaseMailRequest } from "./purchase-mail";

describe("purchase mail", () => {
  it("accepts a vendor email and rejects a vendor name", () => {
    expect(isEmailAddress("buying@harbor.example")).toBe(true);
    expect(isEmailAddress("Harbor Components")).toBe(false);
  });

  it("builds a text message for the mail API", () => {
    expect(
      purchaseMailRequest({
        from: "floor@rackline.example",
        to: "buying@harbor.example",
        subject: "PO-1",
        text: "Please fulfill PO-1.",
      }),
    ).toEqual({
      from: "floor@rackline.example",
      to: "buying@harbor.example",
      subject: "PO-1",
      text: "Please fulfill PO-1.",
    });
  });
});
