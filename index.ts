import { runCli } from "./src/cli/publish.ts";

await runCli(Bun.argv.slice(2));
