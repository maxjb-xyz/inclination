import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodValidationPipe } from "../src/common/zod-validation.pipe";

const schema = z.object({ email: z.string().email(), age: z.number().int().positive() });

describe("ZodValidationPipe", () => {
  it("returns parsed data for valid input", () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ email: "a@b.com", age: 3 })).toEqual({ email: "a@b.com", age: 3 });
  });

  it("throws BadRequest with issues for invalid input", () => {
    const pipe = new ZodValidationPipe(schema);
    expect(() => pipe.transform({ email: "nope", age: -1 })).toThrow(BadRequestException);
  });
});
