import System from "./system";

class Toolchain {
	private deps = [];
	private stack = [];

	private traverse(path: string) {
		const src = System.load(path);
	}

	constructor(path: string) {
		this.traverse(path);
	}
}

const toolchain = new Toolchain("prog.jk");
