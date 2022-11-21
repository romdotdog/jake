import { Dep } from ".";
import * as AST from "./ast";
import * as IR from "./ir";
import { Span } from "./lexer";
import System, { DiagnosticSeverity } from "./system";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function unreachable(_x: never): never {
    throw new Error("unreachable");
}

function neverLocal(span: Span): Local {
    return new Local(span, true, new IR.Never(span));
}

// strange that typescript needs help with this simple type narrow
// stupid javascript semantics, maybe?
function isExponential(atom: AST.Binary): atom is AST.Binary & { kind: AST.BinOp.Arrow } {
    return atom.kind === AST.BinOp.Arrow;
}

function isSum(atom: AST.Binary): atom is AST.Binary & { kind: AST.BinOp.Or } {
    return atom.kind === AST.BinOp.Or;
}

export default class Checker {
    private unit: CompDep[] = [];
    private idxToCompDep: Map<number, CompDep> = new Map();
    private symToLocal: Map<UnresolvedSym, Local> = new Map();
    private functionToExponential: Map<AST.FunctionDeclaration, IR.Exponential> = new Map();
    private resolutionStack: UnresolvedSym[] = [];
    private resolutionSet: Set<UnresolvedSym> = new Set();

    private error(span: Span, message: string) {
        this.system.error({
            span,
            message,
            severity: DiagnosticSeverity.Error
        });
    }

    public exportStage(unit: Dep[]) {
        for (const dep of unit) {
            const namespace = new Namespace();
            const exported: Map<string, UnresolvedSym> = new Map();
            for (const item of dep.ast.items) {
                const name = item.name.link(dep.src);
                const nativeSym = namespace.get(name);
                if (nativeSym !== undefined) {
                    if (nativeSym instanceof UnresolvedFunctions) {
                        nativeSym.items.push(item);
                    } else {
                        throw new Error("invariant violated");
                    }
                } else {
                    namespace.set(name, new UnresolvedFunctions([item]));
                }
                if (item.exported) {
                    const exportedSym = exported.get(name);
                    if (exportedSym !== undefined) {
                        if (exportedSym instanceof UnresolvedFunctions) {
                            exportedSym.items.push(item);
                        } else {
                            throw new Error("invariant violated");
                        }
                    } else {
                        exported.set(name, new UnresolvedFunctions([item]));
                    }
                }
            }

            const compDep = new CompDep(dep, namespace, exported);
            this.unit.push(compDep);
            this.idxToCompDep.set(dep.idx, compDep);
        }
    }

    public importStage() {
        for (const { file, namespace } of this.unit) {
            const importIdx = file.imports;
            const imports = file.ast.imports;
            for (let i = 0; i < importIdx.length; i++) {
                const idx = importIdx[i].idx;
                const import_ = imports[i];
                const importDep = this.idxToCompDep.get(idx);
                if (importDep) {
                    for (const item of import_.with_) {
                        const originalName = item[0].link(file.src);
                        const newName = item[1].link(file.src);
                        const sym = importDep.exported.get(originalName);
                        if (sym) {
                            const nativeSym = namespace.get(newName);
                            if (nativeSym) {
                                if (
                                    sym instanceof UnresolvedFunctions &&
                                    nativeSym instanceof UnresolvedFunctions
                                ) {
                                    Array.prototype.push.apply(nativeSym.items, sym.items);
                                } else {
                                    namespace.set(newName, neverLocal(item[1]));
                                    this.error(item[1], "cannot use this name");
                                }
                            } else if (sym instanceof UnresolvedFunctions) {
                                namespace.set(newName, new UnresolvedFunctions(sym.items.slice()));
                            } else {
                                unreachable(sym);
                            }
                        } else {
                            namespace.set(newName, neverLocal(item[1]));
                            this.error(item[0], "cannot find identifier in exports");
                        }
                    }
                } else {
                    this.error(import_.span, "not supported yet");
                }
            }
        }
    }

    constructor(private system: System, public deps: Dep[], unit: Dep[]) {
        this.exportStage(unit);

        for (const dep of this.unit) {
            dep.namespace.push();
            for (const item of dep.exported.values()) {
                this.resolve(item, dep);
            }
        }
    }

    private resolve(sym: UnresolvedSym, dep: CompDep): Local {
        const cached = this.symToLocal.get(sym);
        if (cached) {
            return cached;
        }

        if (this.resolutionSet.has(sym)) {
            throw new Error("resolution cycle");
        }

        this.addToResolutionStack(sym);
        const local = this.unsafeResolve(sym, dep);
        this.popResolutionStack();

        this.symToLocal.set(sym, local);
        return local;
    }

    private unsafeResolve(item: UnresolvedSym, dep: CompDep): Local {
        if (item instanceof UnresolvedFunctions) {
            const exp = this.resolveFunctions(item, dep);
            if (exp === null) {
                return neverLocal(item.items[0].sig.span);
            }
            return new Local(exp.span, false, exp);
        } else {
            return unreachable(item);
        }
    }

    private resolveFunctions(sym: UnresolvedFunctions, dep: CompDep): IR.ExponentialSum | null {
        const exponentials = [];
        for (const fn of sym.items) {
            const exp = this.functionToExponential.get(fn);
            if (exp !== undefined) {
                exponentials.push(exp);
            } else {
                const exp = this.resolveFunction(fn, dep);
                if (exp !== null) {
                    exponentials.push(exp);
                } else {
                    return null;
                }
            }
        }
        return new IR.ExponentialSum(exponentials[0].span, exponentials);
    }

    private resolveFunction(item: AST.FunctionDeclaration, dep: CompDep): IR.Exponential | null {
        if (item.sig.ty !== undefined) {
            this.error(item.sig.span, "polymorphism is not yet supported");
            return null;
        }

        const params = [];
        for (const param of item.sig.params) {
            if (param === null) {
                return null;
            }
            const pattern = this.pattern(param);
            if (pattern === null) {
                return null;
            }
            params.push(pattern.ty);
        }

        let returnTy: IR.Type;
        const returnTyAtom = item.sig.returnTy;
        switch (returnTyAtom) {
            case undefined:
                this.error(item.sig.span, "type inference is not yet supported");
            // fallthrough
            case null:
                return null;
            default: {
                const resolvedTy = this.ty(returnTyAtom);
                if (resolvedTy === null) {
                    return null;
                }
                returnTy = resolvedTy;
            }
        }

        return new IR.Exponential(item.sig.span, false, params, returnTy);
    }

    private pattern(atom: AST.Atom): IR.Pattern | null {
        const span = atom.span;
        let mut = false;
        if (atom instanceof AST.Mut) {
            if (atom.expr === null) {
                return null;
            }
            mut = true;
            atom = atom.expr;
        }

        let ty: IR.Type | undefined = undefined;
        if (atom instanceof AST.Ascription) {
            if (atom.ty !== null) {
                const resolvedTy = this.ty(atom.ty);
                if (resolvedTy !== null) {
                    ty = resolvedTy;
                }
            }
            if (atom.expr === null) {
                return null;
            }
            atom = atom.expr;
        }

        if (atom instanceof AST.Ident) {
            if (ty === undefined) {
                this.error(span, "untyped patterns are not yet supported");
                ty = new IR.Never(span);
            }
            return new IR.TypedPattern(
                span,
                new IR.UntypedPattern(new Span(span.start, atom.span.end), mut, atom),
                ty
            );
        } else {
            this.error(span, "invalid pattern");
            return null;
        }
    }

    private ty(atom: AST.Atom): IR.Type | null {
        if (atom instanceof AST.Binary) {
            if (isExponential(atom)) {
                return this.exponential(atom);
            } else if (isSum(atom)) {
                return this.sum(atom);
            }
        }

        if (atom instanceof AST.Product) {
            const fields = [];
            for (const field of atom.fields) {
                if (field === null) {
                    return null;
                }
                const ty = this.ty(field);
                if (ty === null) {
                    return null;
                } else {
                    fields.push(ty);
                }
            }
            return new IR.Product(atom.span, fields);
        }

        if (atom instanceof AST.StackTy) {
            return new IR.StackTy(atom.span, atom.value);
        }

        if (atom instanceof AST.HeapTy) {
            return new IR.HeapTy(atom.span, atom.value);
        }

        if (atom instanceof AST.Never) {
            return new IR.Never(atom.span);
        }

        this.error(atom.span, "invalid type");
        return null;
    }

    private exponential(atom: AST.Binary & { kind: AST.BinOp.Arrow }): IR.Exponential | null {
        // right associative
        if (atom.right === null) {
            return null;
        }
        const ret = this.ty(atom.right);
        if (ret === null) {
            return null;
        }
        let next: AST.Atom | null | undefined = atom.left;
        const params = [];
        while (next !== undefined) {
            let possibleExp;
            if (next instanceof AST.Binary && isExponential(next)) {
                possibleExp = next.right;
                next = next.left;
            } else {
                possibleExp = next;
                next = undefined;
            }

            if (possibleExp === null) {
                return null;
            }

            const ty = this.ty(possibleExp);
            if (ty === null) {
                return null;
            }
            params.push(ty);
        }
        return new IR.Exponential(atom.span, false, params, ret);
    }

    private sum(atom: AST.Binary & { kind: AST.BinOp.Or }): IR.ExponentialSum | null {
        if (!(atom.left instanceof AST.Binary) || !isExponential(atom.left)) {
            this.error(atom.span, "sum types not yet supported");
            return null;
        }

        const initialTy = this.exponential(atom.left);
        if (initialTy === null) {
            return null;
        }
        const exponentials: IR.Exponential[] = [initialTy];
        let next: AST.Atom | null | undefined = atom.right;
        while (next !== undefined) {
            let possibleExp;
            if (next instanceof AST.Binary && isSum(next)) {
                possibleExp = next.left;
                next = next.right;
            } else {
                possibleExp = next;
                next = undefined;
            }

            if (possibleExp === null) {
                return null;
            }
            if (!(possibleExp instanceof AST.Binary) || !isExponential(possibleExp)) {
                this.error(
                    possibleExp.span,
                    "cannot mix sum exponential types and sum types; use parentheses"
                );
                return null;
            }
            const ty = this.exponential(possibleExp);
            if (ty === null) {
                return null;
            }
            exponentials.push(ty);
        }

        return new IR.ExponentialSum(atom.span, exponentials);
    }

    private addToResolutionStack(sym: UnresolvedSym) {
        this.resolutionSet.add(sym);
        this.resolutionStack.push(sym);
    }

    private popResolutionStack() {
        const item = this.resolutionStack.pop();
        if (item === undefined) {
            throw new Error("nothing to pop");
        }
        this.resolutionSet.delete(item);
    }
}

class CompDep {
    constructor(
        public file: Dep,
        public namespace: Namespace,
        public exported: Map<string, UnresolvedSym>
    ) {}
}

class Namespace {
    constructor(private parent?: Namespace, private variables: Map<string, Sym> = new Map()) {}

    find(name: string): Sym | null {
        const match = this.variables.get(name);
        if (match !== undefined) {
            return match;
        }
        if (this.parent !== undefined) {
            return this.parent.find(name);
        }
        return null;
    }

    get(name: string) {
        return this.variables.get(name);
    }

    set(name: string, symbol: Sym) {
        this.variables.set(name, symbol);
    }

    push() {
        this.parent = new Namespace(this.parent, this.variables);
        this.variables = new Map();
    }

    pop() {
        if (this.parent === undefined) {
            throw new Error("popped root namespace");
        }
        this.variables = this.parent.variables;
        this.parent = this.parent.parent;
    }
}

type Sym = Local | UnresolvedFunctions;
type UnresolvedSym = UnresolvedFunctions;

class UnresolvedFunctions {
    constructor(public items: AST.FunctionDeclaration[]) {}
}

class Local {
    constructor(public span: Span, public mut: boolean, public ty: IR.Type) {}
}
