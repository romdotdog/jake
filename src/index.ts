import Lexer, { Token } from "./lexer.js";
import System from "./system.js";

class Toolchain {
	private deps = [];
	private stack = [];

	private traverse(path: string) {
		const src = System.load(path);
		const lexer = new Lexer(src);
		while (true) {
			const token = lexer.next();
			console.log(token, lexer.buffer);
			if (token == Token.EOF) {
				break;
			}
		}
	}

	constructor(path: string) {
		this.traverse(path);
	}
}

const toolchain = new Toolchain("prog.jk");
