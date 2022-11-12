import Lexer, { Token } from "./lexer.js";
import Parser from "./parser.js";
import System from "./system.js";

class Toolchain {
	private deps = [];
	private stack = [];

	private traverse(path: string) {
		const src = System.load(path);
		/*const lexer = new Lexer(src);
		let token;
		do {
			token = lexer.next();
			console.log(token);
		} while (token != Token.EOF);*/

		const parser = new Parser(new Lexer(src));
		console.log(JSON.stringify(parser.parse()));
	}

	constructor(path: string) {
		this.traverse(path);
	}
}

const toolchain = new Toolchain("prog.jk");
