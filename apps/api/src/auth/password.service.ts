import { Injectable } from "@nestjs/common";
import argon2 from "argon2";

/** Argon2id password hashing (spec §9). */
@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, { type: argon2.argon2id });
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }
}
