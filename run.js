import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import concurrently from "concurrently";

const dirs = (await readdir(".", { withFileTypes: true }))
    .filter(dirent => dirent.isDirectory() && existsSync(join(dirent.name, "package.json")))
    .map(dirent => dirent.name);

concurrently(
    dirs.map(v => {
        return {
            command: process.argv.slice(2).join(" "),
            name: v,
            cwd: v
        };
    })
);
