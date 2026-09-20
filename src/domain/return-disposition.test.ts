import { describe, expect, it } from "vitest";
import { balanceKey } from "./inventory";
import {
  dispositionLabel,
  parseDisposition,
  returnPostedMessage,
  returnReceiveSteps,
  showPutawayAfterReturn,
} from "./return-disposition";

describe("return disposition", () => {
  it("defaults blank to restock", () => {
    expect(parseDisposition(undefined)).toBe("restock");
    expect(parseDisposition("")).toBe("restock");
    expect(parseDisposition("HOLD")).toBe("hold");
    expect(parseDisposition("scrap")).toBe("scrap");
  });

  it("rejects unknown dispositions", () => {
    expect(() => parseDisposition("donate")).toThrow(/restock, scrap, or hold/);
  });

  it("labels the three floor choices", () => {
    expect(dispositionLabel("restock")).toBe("Restock");
    expect(dispositionLabel("scrap")).toBe("Scrap");
    expect(dispositionLabel("hold")).toBe("Hold");
  });

  it("hides putaway unless something was restocked", () => {
    expect(showPutawayAfterReturn(["scrap"])).toBe(false);
    expect(showPutawayAfterReturn(["hold"])).toBe(false);
    expect(showPutawayAfterReturn(["scrap", "restock"])).toBe(true);
  });

  it("names the floor confirmation from posted dispositions", () => {
    expect(returnPostedMessage("RMA-1", ["restock"])).toBe("RMA-1 received back into the bay.");
    expect(returnPostedMessage("RMA-1", ["scrap"])).toBe("RMA-1 received and scrapped.");
    expect(returnPostedMessage("RMA-1", ["hold"])).toBe("RMA-1 received and held at the dock.");
    expect(returnPostedMessage("RMA-1", ["scrap", "hold"])).toBe("RMA-1 received.");
  });

  it("scraps in the same plan so on-hand is unchanged", () => {
    const [receive, scrap] = returnReceiveSteps({
      itemId: "shade",
      sku: "SHADE",
      locationId: "RECV",
      qty: 1,
      refId: "rma-1",
      disposition: "scrap",
    });
    const afterReceive = receive(new Map([[balanceKey("RECV", "shade"), 4]]));
    const afterScrap = scrap!(afterReceive.balances);
    expect(afterReceive.movements.map((row) => row.type)).toEqual(["receive"]);
    expect(afterScrap.balances.get(balanceKey("RECV", "shade"))).toBe(4);
    expect(afterScrap.movements.map((row) => row.type)).toEqual(["scrap"]);
  });

  it("restock is a single receive", () => {
    expect(
      returnReceiveSteps({
        itemId: "shade",
        sku: "SHADE",
        locationId: "RECV",
        qty: 1,
        refId: "rma-1",
        disposition: "restock",
      }),
    ).toHaveLength(1);
  });
});
