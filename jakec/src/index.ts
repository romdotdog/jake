import { join } from "path";
import { Source } from "./ast.js";
import { Program } from "./ir.js";
import Checker, { CompDep } from "./checker.js";
import Lexer from "./lexer.js";
import Parser from "./parser.js";
import System, { ChildSystem, ConsoleSystem } from "./system.js";

class Toolchain {
    private deps: Dep[] = [];
    private stack: Dep[] = [];
    private pathToDep: Map<string, Dep> = new Map();
    private idxToCompDep: Map<number, CompDep> = new Map();
    private program: Program = new Program();

    private traverse(path: string, maybeSrc?: string): Dep | undefined {
        const src = maybeSrc ?? this.system.load(path);
        if (src === undefined) {
            return undefined;
        }
        const idx = this.deps.length;
        const ast = new Parser(this.system, new Lexer(src), path, idx).parse();
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

    compile(root: string, maybeSrc?: string) {
        this.traverse(this.system.resolve(root), maybeSrc);
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

const system = process.argv.includes("--child") ? new ChildSystem() : new ConsoleSystem();
const toolchain = new Toolchain(system);
const path = "src/index.jk";
const src = system.load(path);
if (src !== undefined) {
    toolchain.compile(path, src);
} else {
    console.log("no entrypoint");
}
