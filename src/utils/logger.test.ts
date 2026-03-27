// src/utils/logger.test.ts
import { expect, test } from "bun:test";
import { logger } from "./logger";

test("logger object exists and can log", () => {
  expect(logger).toBeDefined();
  expect(typeof logger.info).toBe("function");
});
