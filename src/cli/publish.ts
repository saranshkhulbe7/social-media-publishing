import { getPublishStatus, publish } from "../index.ts";
import type { PublishInput, PublishResult } from "../domain/types.ts";

function printUsage(): void {
  console.log(`Usage:
  bun run index.ts publish <payload.json>
  bun run index.ts status <request-id>`);
}

function shouldExitNonZero(result: PublishResult): boolean {
  return result.overallStatus !== "success";
}

async function readPayload(filePath: string): Promise<PublishInput> {
  return Bun.file(filePath).json() as Promise<PublishInput>;
}

async function runPublish(payloadPath: string): Promise<void> {
  const payload = await readPayload(payloadPath);
  const result = await publish(payload);
  console.log(JSON.stringify(result, null, 2));
  if (shouldExitNonZero(result)) {
    process.exitCode = 1;
  }
}

async function runStatus(requestId: string): Promise<void> {
  const result = await getPublishStatus(requestId);
  console.log(JSON.stringify(result, null, 2));
  if (shouldExitNonZero(result)) {
    process.exitCode = 1;
  }
}

export async function runCli(args: string[]): Promise<void> {
  const [command, value] = args;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  try {
    if (command === "publish") {
      if (!value) {
        throw new Error("Missing payload path. Expected: bun run index.ts publish <payload.json>");
      }
      await runPublish(value);
      return;
    }

    if (command === "status") {
      if (!value) {
        throw new Error("Missing request id. Expected: bun run index.ts status <request-id>");
      }
      await runStatus(value);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
