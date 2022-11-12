import { Source } from "./ast.js";
import Lexer, { Token } from "./lexer.js";
import Parser from "./parser.js";
import System from "./system.js";

class Toolchain {
	private deps: Dep[] = [];
	private stack: Dep[] = [];
	private pathToDep: Map<string, Dep> = new Map();

	private traverse(path: string): Dep {
		const src = System.load(path);
		const ast = new Parser(new Lexer(src)).parse();
		const dep = new Dep(this.deps.length, path, src, ast);
		this.deps.push(dep);
		this.pathToDep.set(path, dep);
		this.stack.push(dep);

		for (const import_ of ast.imports) {
			const relativePath = import_.path;
			const path = System.resolve(relativePath.value);
			const importDep = this.pathToDep.get(path);
			if (importDep !== undefined) {
				dep.imports.push(importDep);
				if (importDep.onStack) {
					dep.llv = Math.min(dep.llv, importDep.idx);
				}
			} else {
				const importDep = this.traverse(path);
				dep.imports.push(importDep);
				dep.llv = Math.min(dep.llv, importDep.llv);
			}
		}

		const idx = dep.idx;
		if (idx == dep.llv) {
			let i = this.stack.length;
			while (i > 0 && i != idx) {
				i -= 1;
				const node = this.deps[i];
				node.onStack = false;
				node.llv = idx;
			}

			const unit = this.stack.splice(i);
			console.log(unit);
		}

		return dep;
	}

	constructor(path: string) {
		this.traverse(System.resolve(path));
	}
}

class Dep {
	public imports: Dep[] = [];
	public onStack = true;
	public llv: number;
	constructor(public idx: number, public path: string, public src: string, public ast: Source) {
		this.llv = idx;
	}
}

const toolchain = new Toolchain("prog.jk");
