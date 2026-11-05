import { create } from "zustand";

type User = { email: string; role: "OWNER" | "STAFF" };

type Store = {
  user: User | null;
  setUser: (u: User | null) => void;
};

export const useStore = create<Store>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
