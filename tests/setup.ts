import { beforeEach } from "vitest";
import { useStore } from "@/store";

// Every test starts from a clean seed.
beforeEach(() => {
  useStore.getState().reset();
});
