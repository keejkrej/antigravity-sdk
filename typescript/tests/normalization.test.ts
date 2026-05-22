import { expect, test, describe } from "bun:test";
import { normalizeStepState, normalizeTrajectoryState } from "../src/local_connection.ts";
import * as Types from "../src/types.ts";

describe("State Normalization", () => {
  describe("normalizeStepState", () => {
    test("handles string enum values", () => {
      expect(normalizeStepState("STATE_WAITING_FOR_USER")).toBe(Types.StepState.STATE_WAITING_FOR_USER);
      expect(normalizeStepState("STATE_DONE")).toBe(Types.StepState.STATE_DONE);
      expect(normalizeStepState("STATE_ERROR")).toBe(Types.StepState.STATE_ERROR);
      expect(normalizeStepState("STATE_ACTIVE")).toBe(Types.StepState.STATE_ACTIVE);
      expect(normalizeStepState("STATE_UNSPECIFIED")).toBe(Types.StepState.STATE_UNSPECIFIED);

      // Short versions
      expect(normalizeStepState("WAITING_FOR_USER")).toBe(Types.StepState.STATE_WAITING_FOR_USER);
      expect(normalizeStepState("DONE")).toBe(Types.StepState.STATE_DONE);
      expect(normalizeStepState("ERROR")).toBe(Types.StepState.STATE_ERROR);
      expect(normalizeStepState("ACTIVE")).toBe(Types.StepState.STATE_ACTIVE);
      expect(normalizeStepState("UNSPECIFIED")).toBe(Types.StepState.STATE_UNSPECIFIED);
    });

    test("handles numeric enum values", () => {
      expect(normalizeStepState(3)).toBe(Types.StepState.STATE_WAITING_FOR_USER);
      expect(normalizeStepState(2)).toBe(Types.StepState.STATE_DONE);
      expect(normalizeStepState(4)).toBe(Types.StepState.STATE_ERROR);
      expect(normalizeStepState(1)).toBe(Types.StepState.STATE_ACTIVE);
      expect(normalizeStepState(0)).toBe(Types.StepState.STATE_UNSPECIFIED);
    });

    test("handles null, undefined, and fallback values", () => {
      expect(normalizeStepState(null)).toBe(Types.StepState.STATE_UNSPECIFIED);
      expect(normalizeStepState(undefined)).toBe(Types.StepState.STATE_UNSPECIFIED);
      expect(normalizeStepState("INVALID_STATE")).toBe(Types.StepState.STATE_UNSPECIFIED);
    });
  });

  describe("normalizeTrajectoryState", () => {
    test("handles string enum values", () => {
      expect(normalizeTrajectoryState("STATE_RUNNING")).toBe(Types.TrajectoryState.STATE_RUNNING);
      expect(normalizeTrajectoryState("STATE_IDLE")).toBe(Types.TrajectoryState.STATE_IDLE);
      expect(normalizeTrajectoryState("STATE_UNSPECIFIED")).toBe(Types.TrajectoryState.STATE_UNSPECIFIED);

      // Short versions
      expect(normalizeTrajectoryState("RUNNING")).toBe(Types.TrajectoryState.STATE_RUNNING);
      expect(normalizeTrajectoryState("IDLE")).toBe(Types.TrajectoryState.STATE_IDLE);
      expect(normalizeTrajectoryState("UNSPECIFIED")).toBe(Types.TrajectoryState.STATE_UNSPECIFIED);
    });

    test("handles numeric enum values", () => {
      expect(normalizeTrajectoryState(1)).toBe(Types.TrajectoryState.STATE_RUNNING);
      expect(normalizeTrajectoryState(2)).toBe(Types.TrajectoryState.STATE_IDLE);
      expect(normalizeTrajectoryState(0)).toBe(Types.TrajectoryState.STATE_UNSPECIFIED);
    });

    test("handles null, undefined, and fallback values", () => {
      expect(normalizeTrajectoryState(null)).toBe(Types.TrajectoryState.STATE_UNSPECIFIED);
      expect(normalizeTrajectoryState(undefined)).toBe(Types.TrajectoryState.STATE_UNSPECIFIED);
      expect(normalizeTrajectoryState("INVALID_STATE")).toBe(Types.TrajectoryState.STATE_UNSPECIFIED);
    });
  });
});
