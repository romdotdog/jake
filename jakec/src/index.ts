import { join } from "path";
import { Source } from "./ast.js";
import { Program } from "./ir.js";
import Checker, { CompDep } from "./checker.js";
import Lexer from "./lexer.js";
import Parser from "./parser.js";
import System, { ChildSystem } from "./system.js";

class Toolchain {
    private deps: Dep[] = [];
    private stack: Dep[] = [];
    private pathToDep: Map<string, Dep> = new Map();
    private idxToCompDep: Map<number, CompDep> = new Map();
    private program: Program = new Program();

    private traverse(path: string): Dep | undefined {
        const src = this.system.load(path);
        if (src === undefined) {
            return undefined;
        }
        const idx = this.deps.length;
        const ast = new Parser(this.system, new Lexer(src), idx).parse();
        const dep = new Dep(idx, path, src, ast);
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
                if (importDep !== undefined) {
                    dep.llv = Math.min(dep.llv, importDep.llv);
                }
            }
        }

        if (idx == dep.llv) {
            let i = this.stack.length;
            while (i > 0 && i != idx) {
                i -= 1;
                const node = this.deps[i];
                node.onStack = false;
                node.llv = idx;
            }

            const unit = this.stack.splice(i);
            const checker = new Checker(
                this.system,
                this.program,
                this.idxToCompDep,
                this.deps,
                unit
            );
        }

        return dep;
    }

    constructor(private system: System) {}

    compile(root: string) {
        this.traverse(this.system.resolve(root));
    }
}

export class Dep {
    public imports: Array<Dep | undefined> = [];
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
