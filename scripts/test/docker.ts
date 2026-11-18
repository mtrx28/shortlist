import { spawnSync } from "node:child_process";

// True when the Docker engine answers. The local Supabase stack needs it.
export function dockerRunning(): boolean {
  const r = spawnSync("docker", ["info"], { shell: true, stdio: "ignore" });
  return r.status === 0;
}
