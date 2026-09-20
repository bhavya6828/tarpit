import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("README has the essential project sections", () => {
  for (const section of ["Product", "Problem", "Solution", "Pipeline", "Test locally"]) {
    assert.match(readme, new RegExp(`## ${section}\\n\\n([^\\n]+\\n){2}`));
  }
});

test("README ends with the project credits", () => {
  assert.match(
    readme.trim(),
    /Built by Max Gong, Kate Kaneshiro, Bhavya Wadhwa, and Hong Cheng Wang\.$/
  );
});
