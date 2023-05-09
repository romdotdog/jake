import { join } from "path";
import { Root } from "./ast.js";
import { Program } from "./ir.js";
import Checker, { Source } from "./checker.js";
import Lexer from "./lexer.js";
import Parser from "./parser.js";
import System, { ChildSystem, ConsoleSystem } from "./system.js";
import { CodeGen } from "./codegen.js";

class Toolchain {
    private files: File[] = [];
    private stack: File[] = [];
    private pathToFile: Map<string, File> = new Map();
    private idxToSource: Map<number, Source> = new Map();
    private program = new Program();
    private checker = new Checker(this.system, this.program, this.idxToSource, this.files);

    private traverse(path: string, maybeSrc?: string): File | undefined {
        const src = maybeSrc ?? this.system.load(path);
        if (src === undefined) {
            return undefined;
        }
        const idx = this.files.length;
        const ast = new Parser(this.system, new Lexer(src), path, idx).parse();
        const file = new File(idx, path, src, ast);
        this.files.push(file);
        this.pathToFile.set(path, file);
        this.stack.push(file);

        for (const import_ of ast.imports) {
            const relativePath = import_.path;
            const importPath = this.system.resolve(join(path, "..", relativePath.value));
            const importFile = this.pathToFile.get(importPath);
            if (importFile !== undefined) {
                file.imports.push(importFile);
                if (importFile.onStack) {
                    file.llv = Math.min(file.llv, importFile.idx);
                }
            } else {
                const importFile = this.traverse(importPath);
                file.imports.push(importFile);
                if (importFile !== undefined) {
                    file.llv = Math.min(file.llv, importFile.llv);
                }
            }
        }

        if (idx == file.llv) {
            let i = this.stack.length;
            while (i > 0 && i != idx) {
                i -= 1;
                const node = this.files[i];
                node.onStack = false;
                node.llv = idx;
            }

            const unit = this.stack.splice(i);
            this.checker.run(unit);
        }

        return file;
    }

    constructor(private system: System) {}

    public static compile(system: System, root: string, maybeSrc?: string) {
        const toolchain = new Toolchain(system);
        toolchain.traverse(system.resolve(root), maybeSrc);
        system.write(
            "a.ir",
            JSON.stringify(
                toolchain.program,
                (key, value) => (key === "span" ? null : typeof value === "bigint" ? value.toString() : value),
                2
            )
        );
        system.write("a.wat", CodeGen.run(system, toolchain.program, toolchain.files));
    }
}

// TODO: fix field leak
export class File {
    public imports: Array<File | undefined> = [];
    public onStack = true;
    public llv: number;
    constructor(public idx: number, public path: string, public code: string, public ast: Root) {
        this.llv = idx;
    }
}

const system = process.argv.includes("--child") ? new ChildSystem() : new ConsoleSystem();
const path = "src/index.jk";
const src = system.load(path);
if (src !== undefined) {
    Toolchain.compile(system, path, src);
} else {
    console.log("no entrypoint");
}
