import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("publishes one master key safely across concurrent processes", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rbmail-key-race-"));
  const moduleUrl = new URL("./crypto.ts", import.meta.url).href;
  const script = `
    const { getMasterKey } = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(getMasterKey().toString("hex"));
  `;

  try {
    const keys = await Promise.all(
      Array.from({ length: 12 }, () => {
        return new Promise<string>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["--experimental-strip-types", "--input-type=module", "-e", script],
            {
              env: { ...process.env, RBMAIL_DATA_DIR: directory },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let output = "";
          let error = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk) => {
            output += chunk;
          });
          child.stderr.on("data", (chunk) => {
            error += chunk;
          });
          child.on("error", reject);
          child.on("close", (code) => {
            if (code === 0) resolve(output);
            else reject(new Error(error || `Child process exited ${code}.`));
          });
        });
      }),
    );

    assert.equal(new Set(keys).size, 1);
    assert.equal(keys[0]?.length, 64);
    assert.deepEqual(readdirSync(directory), ["master.key"]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
