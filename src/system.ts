import { readFileSync } from "fs";
import { resolve } from "path";

export default class System {
	static load(path: string): string {
		return readFileSync(path, "utf-8");
	}

	static resolve(path: string): string {
		return resolve(path);
	}
}
