import { beforeEach } from "vitest";
import { useStore } from "@/store";

// Every test starts from the fresh (pre-prep) seed so rule tests drive
// submissions from scratch.
beforeEach(() => {
  useStore.getState().reset(true);
});
