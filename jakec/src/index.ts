import { join } from "path";
import { Source } from "./ast.js";
import Lexer from "./lexer.js";
import Parser from "./parser.js";
import System, { ChildSystem } from "./system.js";

class Toolchain {
    private deps: Dep[] = [];
    private stack: Dep[] = [];
    private pathToDep: Map<string, Dep> = new Map();

    private traverse(path: string): Dep {
        const src = this.system.load(path);
        const ast = new Parser(this.system, new Lexer(src)).parse();
        const dep = new Dep(this.deps.length, path, src, ast);
        this.deps.push(dep);
        this.pathToDep.set(path, dep);
        this.stack.push(dep);

        for (const import_ of ast.imports) {
            const relativePath = import_.path;
            const importPath = this.system.resolve(join(path, "..", relativePath.value));
            const importDep = this.pathToDep.get(importPath);
            if (importDep !== undefined) {
                dep.imports.push(importDep);
                if (importDep.onStack) {
                    dep.llv = Math.min(dep.llv, importDep.idx);
                }
            } else {
                const importDep = this.traverse(importPath);
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

    constructor(private system: System) {}

    compile(root: string) {
        this.traverse(this.system.resolve(root));
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

if (process.argv.includes("--child")) {
    const toolchain = new Toolchain(new ChildSystem());
    toolchain.compile(process.argv[2]);
}
