import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Tokens } from "./authClient";
import type { PublicUser } from "./types";

interface AuthState {
  user: PublicUser | null;
  tokens: Tokens | null;
  setSession: (user: PublicUser, tokens: Tokens) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tokens: null,
      setSession: (user, tokens) => set({ user, tokens }),
      clear: () => set({ user: null, tokens: null }),
    }),
    { name: "inclination-auth" },
  ),
);
