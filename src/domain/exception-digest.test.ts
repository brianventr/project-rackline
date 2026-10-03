import { describe, expect, it } from "vitest";
import { exceptionDigest } from "./exception-digest";

describe("exception digest", () => {
  it("names up to three blocking problems and links Exceptions", () => {
    const mail = exceptionDigest({
      orgName: "Northwind",
      appUrl: "https://rackline.example/",
      problems: [
        { title: "ORD-1 cannot ship", detail: "Add a ship weight." },
        { title: "Held bay", detail: "A-01-01 is locked." },
        { title: "Third", detail: "Look at it." },
        { title: "Fourth", detail: "Left off." },
      ],
    });
    expect(mail.subject).toBe("3 things need you at Northwind");
    expect(mail.text).toContain("1. ORD-1 cannot ship");
    expect(mail.text).not.toContain("Fourth");
    expect(mail.text).toContain("https://rackline.example/exceptions");
  });
});