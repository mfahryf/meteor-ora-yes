import { expect, test } from "bun:test";
import { hello } from "./index";

test("hello returns greeting", () => {
  expect(hello()).toBe("DLMM Agent starting...");
});
