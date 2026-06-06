import { describe, expect, it } from "vitest";
import { buildCollabWsUrl } from "../src/collab/wsUrl";

describe("buildCollabWsUrl", () => {
  it("resolves the default relative path against an http origin as ws", () => {
    expect(buildCollabWsUrl("/collab", "http://localhost:5173")).toBe("ws://localhost:5173/collab");
  });

  it("resolves a relative path against an https origin as wss", () => {
    expect(buildCollabWsUrl("/collab", "https://app.example.com")).toBe(
      "wss://app.example.com/collab",
    );
  });

  it("honors an already-absolute ws URL", () => {
    expect(buildCollabWsUrl("ws://sync:3002/collab", "https://ignored")).toBe(
      "ws://sync:3002/collab",
    );
  });

  it("honors an already-absolute wss URL", () => {
    expect(buildCollabWsUrl("wss://sync.example.com/collab", "https://ignored")).toBe(
      "wss://sync.example.com/collab",
    );
  });

  it("maps an absolute http URL to ws and https to wss", () => {
    expect(buildCollabWsUrl("http://sync:3002/collab")).toBe("ws://sync:3002/collab");
    expect(buildCollabWsUrl("https://sync.example.com/collab")).toBe(
      "wss://sync.example.com/collab",
    );
  });
});
