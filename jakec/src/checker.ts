import { Dep } from ".";
import * as AST from "./ast.js";
import * as IR from "./ir.js";
import { Span } from "./lexer.js";
import System, { DiagnosticSeverity } from "./system.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function unreachable(_x: never): never {
    throw new Error("unreachable");
}

// strange that typescript needs help with this simple type narrow
// stupid javascript semantics, maybe?
function isExponential(atom: AST.Binary): atom is AST.Binary & { kind: AST.BinOp.Arrow } {
    return atom.kind === AST.BinOp.Arrow;
}

function isSum(atom: AST.Binary): atom is AST.Binary & { kind: AST.BinOp.Or } {
    return atom.kind === AST.BinOp.Or;
}

function identityGuard<T>(x: T): x is T {
    return true;
}

export default class Checker {
    private unit: CompDep[] = [];
    private symToResolvedSym: Map<UnresolvedSym, ResolvedSym> = new Map();
    private declToFunction: Map<AST.FunctionDeclaration, IR.SingleFunction> = new Map();
    private resolutionStack: UnresolvedSym[] = [];
    private resolutionSet: Set<UnresolvedSym> = new Set();

    private error(span: Span, message: string) {
        const dep = this.deps[span.idx];
        this.system.error(
            {
                path: dep.path,
                span,
                message,
                severity: DiagnosticSeverity.Error
            },
            dep.src
        );
    }

    private exportStage(unit: Dep[]) {
        for (const dep of unit) {
            const scope = new Scope();
            const exported: Map<string, UnresolvedSym> = new Map();
            for (const item of dep.ast.items) {
                const name = item.name.link(dep.src);
                const nativeSym = scope.getSameScope(name);
                if (nativeSym !== undefined) {
                    if (nativeSym instanceof UnresolvedFunctions) {
                        nativeSym.items.push(item);
                    } else {
                        throw new Error("invariant violated");
                    }
                } else {
                    scope.set(name, new UnresolvedFunctions([item]));
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

            const compDep = new CompDep(dep, scope, exported);
            this.unit.push(compDep);
            this.idxToCompDep.set(dep.idx, compDep);
        }
    }

    private importStage() {
        for (const { file, scope: scope } of this.unit) {
            const importIdx = file.imports;
            const imports = file.ast.imports;
            for (let i = 0; i < importIdx.length; i++) {
                const import_ = imports[i];
                const importRawDep = importIdx[i];
                if (importRawDep === undefined) {
                    this.error(import_.path.span, "unable to open file");
                    // TODO: never the import
                    continue;
                }
                const idx = importRawDep.idx;
                const importDep = this.idxToCompDep.get(idx);
                if (importDep === undefined) {
                    throw new Error("imported an unresolved module");
                }
                for (const item of import_.with_) {
                    const originalName = item[0].link(file.src);
                    const newName = item[1].link(file.src);
                    const sym = importDep.exported.get(originalName);
                    if (sym) {
                        const nativeSym = scope.find(newName);
                        if (nativeSym) {
                            if (
                                sym instanceof UnresolvedFunctions &&
                                nativeSym instanceof UnresolvedFunctions
                            ) {
                                Array.prototype.push.apply(nativeSym.items, sym.items);
                            } else {
                                scope.set(newName, new IR.Unreachable(item[1]));
                                this.error(item[1], "cannot use this name");
                            }
                        } else if (sym instanceof UnresolvedFunctions) {
                            scope.set(newName, new UnresolvedFunctions(sym.items.slice()));
                        } else {
                            unreachable(sym);
                        }
                    } else {
                        scope.set(newName, new IR.Unreachable(item[0]));
                        this.error(item[0], "cannot find identifier in exports");
                    }
                }
            }
            for (const hostImport of file.ast.hostImports) {
                const pathComponents = hostImport.path.value.split("/");
                const last = pathComponents.length - 1;
                const functionName = pathComponents[last];
                const moduleName = pathComponents.slice(0, last).join("/");
                const name = hostImport.name.link(file.src);
                let ty: IR.Exponential<IR.WASMStackType, IR.WASMResultType> | IR.Never | null =
                    null;
                if (hostImport.ty !== null) {
                    if (hostImport.ty instanceof AST.Binary && isExponential(hostImport.ty)) {
                        const resolvedTy = this.exponentialPred(
                            hostImport.ty,
                            (param: IR.Type): param is IR.WASMStackType => {
                                if (param instanceof IR.StackTy || param instanceof IR.Never) {
                                    return true;
                                }
                                this.error(hostImport.span, "not allowed");
                                return false;
                            },
                            (result: IR.Type): result is IR.WASMResultType => {
                                if (
                                    result instanceof IR.StackTy ||
                                    result instanceof IR.Never ||
                                    IR.Product.isVoid(result)
                                ) {
                                    return true;
                                }
                                this.error(hostImport.span, "not allowed");
                                return false;
                            }
                        );
                        if (resolvedTy !== null) {
                            ty = resolvedTy;
                        }
                    } else {
                        this.error(hostImport.span, "type of host import must be exponential");
                    }
                }
                ty ??= new IR.Never(hostImport.span);
                const resolvedImport = new IR.HostImport(
                    IR.labelize(`${file.path}/${name}_${ty.print()}`),
                    moduleName,
                    functionName,
                    ty
                );
                this.program.contents.push(resolvedImport);
            }
        }
    }

    constructor(
        private system: System,
        private program: IR.Program,
        private idxToCompDep: Map<number, CompDep>,
        public deps: Dep[]
    ) {}

    public static run(
        system: System,
        program: IR.Program,
        idxToCompDep: Map<number, CompDep>,
        deps: Dep[],
        unit: Dep[]
    ) {
        const checker = new Checker(system, program, idxToCompDep, deps);
        checker.exportStage(unit);
        checker.importStage();

        for (const dep of checker.unit) {
            dep.scope.push();
            for (const item of dep.exported.values()) {
                checker.resolve(item);
            }
            if (dep.file.topLevel) {
                const sym = dep.scope.find("main");
                if (sym !== undefined && sym instanceof UnresolvedFunctions) {
                    const resolved = checker.resolve(sym);
                    if (resolved instanceof IR.SingleFunction && resolved.params.length == 0) {
                        resolved.internalName = "_start";
                    }
                }
            }
        }
    }

    private resolve(sym: UnresolvedSym): ResolvedSym {
        const cached = this.symToResolvedSym.get(sym);
        if (cached) {
            return cached;
        }

        if (this.resolutionSet.has(sym)) {
            throw new Error("resolution cycle");
        }

        this.addToResolutionStack(sym);
        const local = this.unsafeResolve(sym);
        this.popResolutionStack();

        this.symToResolvedSym.set(sym, local);
        return local;
    }

    private unsafeResolve(sym: UnresolvedSym): ResolvedSym {
        if (sym instanceof UnresolvedFunctions) {
            return this.resolveFunctions(sym);
        } else {
            return unreachable(sym);
        }
    }

    private resolveFunctions(sym: UnresolvedFunctions): ResolvedSym {
        if (sym.items.length == 1) {
            const fn = sym.items[0];
            return this.declToFunction.get(fn) ?? this.resolveFunction(fn);
        }

        const fns: IR.SingleFunction[] = [];
        const exponentials: IR.Exponential[] = [];
        for (const fn of sym.items) {
            const newExp = this.declToFunction.get(fn) ?? this.resolveFunction(fn);
            if (newExp instanceof IR.Unreachable) {
                return new IR.Unreachable(sym.items[0].span);
            }
            for (const exp of exponentials) {
                if (newExp.ty.equals(exp)) {
                    this.error(fn.sig.span, "conflicting implementations");
                    return new IR.Unreachable(fn.sig.span);
                }
            }
            fns.push(newExp);
            exponentials.push(newExp.ty);
        }

        const nameSpan = sym.items[0].sig.name;
        const dep = this.deps[nameSpan.idx];
        return new IR.FunctionSum(
            sym.items[0].sig.name.link(dep.src),
            fns,
            new IR.ExponentialSum(exponentials[0].span, exponentials)
        );
    }

    private resolveFunction(item: AST.FunctionDeclaration): IR.SingleFunction | IR.Unreachable {
        if (item.sig.ty !== undefined) {
            this.error(item.sig.span, "polymorphism is not yet supported");
            return new IR.Unreachable(item.sig.span);
        }

        const dep = this.idxToCompDep.get(item.span.idx);
        if (dep === undefined) {
            throw new Error("couldn't find dep");
        }

        const tyParams: IR.WASMResultType[] = [];
        const params = [];
        for (const param of item.sig.params) {
            if (param === null) {
                return new IR.Unreachable(item.sig.span);
            }
            const pattern = this.pattern(param);
            if (pattern === null) {
                return new IR.Unreachable(param.span);
            }

            const ty = pattern.ty;
            if (
                ty instanceof IR.ExponentialSum ||
                ty instanceof IR.Exponential ||
                ty instanceof IR.Product
            ) {
                this.error(pattern.ty.span, "params cannot have this type");
                return new IR.Unreachable(param.span);
            }

            if (ty instanceof IR.HeapTy) {
                this.error(pattern.ty.span, "heap types cannot exist on the stack");
                return new IR.Unreachable(param.span);
            }

            tyParams.push(ty);
            const name = pattern.untyped.ident.span.link(dep.file.src);
            params.push(new IR.Local(params.length, name, pattern.untyped.mut, ty));
        }
        if (tyParams.length == 0) {
            tyParams.push(IR.Product.void(item.sig.span));
        }

        let returnTy: IR.Type;
        const returnTyAtom = item.sig.returnTy;
        switch (returnTyAtom) {
            case undefined:
                this.error(item.sig.span, "type inference is not yet supported");
            // fallthrough
            case null:
                return new IR.Unreachable(item.sig.span);
            default: {
                const resolvedTy = this.ty(returnTyAtom);
                if (resolvedTy === null) {
                    return new IR.Unreachable(item.sig.span);
                }
                returnTy = resolvedTy;
            }
        }

        if (
            returnTy instanceof IR.ExponentialSum ||
            returnTy instanceof IR.Exponential ||
            (returnTy instanceof IR.Product && !IR.Product.isVoid(returnTy))
        ) {
            this.error(returnTy.span, "returns cannot have this type");
            return new IR.Unreachable(returnTy.span);
        }

        if (returnTy instanceof IR.HeapTy) {
            this.error(returnTy.span, "heap types cannot exist on the stack");
            return new IR.Unreachable(returnTy.span);
        }

        const ty = new IR.Exponential(item.sig.span, false, tyParams, returnTy);
        const name = item.sig.name.link(dep.file.src);

        const binOp = AST.nameToBinOp.get(name);
        if (binOp && ty.params.length !== 2) {
            this.error(item.sig.span, "binary operator overloads must take exactly two parameters");
            return new IR.Unreachable(item.sig.span);
        }

        const unOp = AST.nameToUnOp.get(name);
        if (unOp && ty.params.length !== 1) {
            this.error(item.sig.span, "unary operator overloads must take exactly one parameter");
            return new IR.Unreachable(item.sig.span);
        }

        const internalName = IR.labelize(`${dep.file.path}/${name}_${ty.print()}`);
        const fn = new IR.SingleFunction(internalName, name, ty, params, [], []);
        this.resolveBody(fn, item.body, dep);

        this.declToFunction.set(item, fn);
        this.program.contents.push(fn);
        return fn;
    }

    private resolveBody(fn: IR.SingleFunction, body: AST.Statement[], dep: CompDep) {
        const { file, scope } = dep;
        scope.push();
        for (const param of fn.params) {
            scope.set(param.name, param);
        }
        let needsReturn = true;
        for (const statement of body) {
            if (this.resolveStatement(fn, statement, dep)) {
                needsReturn = false;
                break;
            }
        }
        if (needsReturn && !IR.Product.void(fn.ty.ret.span).assignableTo(fn.ty.ret)) {
            this.error(fn.ty.ret.span, "function needs a return statement");
            fn.body.push(IR.Unreachable.drop(fn.ty.ret.span));
        }
        scope.pop();
    }

    private resolveStatement(
        fn: IR.SingleFunction,
        statement: AST.Statement,
        dep: CompDep
    ): boolean {
        const { file, scope } = dep;
        if (statement instanceof AST.Let) {
            if (statement.pattern === null) {
                fn.body.push(IR.Unreachable.drop(statement.span));
                return false;
            }
            const pattern = this.pattern(statement.pattern);
            if (pattern === null) {
                fn.body.push(IR.Unreachable.drop(statement.pattern.span));
                return false;
            }

            const name = pattern.untyped.ident.span.link(dep.file.src);
            const ty = pattern.ty;
            const isUnsupported =
                ty instanceof IR.ExponentialSum ||
                ty instanceof IR.Exponential ||
                ty instanceof IR.Product;
            const isHeapTy = ty instanceof IR.HeapTy;

            if (statement.expr === null || isUnsupported || isHeapTy) {
                if (isUnsupported) {
                    this.error(pattern.ty.span, "locals cannot have this type");
                } else if (isHeapTy) {
                    this.error(pattern.ty.span, "heap types cannot exist on the stack");
                }
                const local = fn.addLocal(name, pattern.untyped.mut, new IR.Never(statement.span));
                scope.set(name, local);
                fn.body.push(new IR.LocalSet(local, new IR.Unreachable(statement.span)));
                return false;
            }

            const local = fn.addLocal(name, pattern.untyped.mut, ty);
            scope.set(name, local);
            fn.body.push(new IR.LocalSet(local, this.checkExpr(statement.expr, dep, pattern.ty)));
            return false;
        } else if (statement instanceof AST.Assign) {
            if (statement.left === null) {
                return false;
            }

            if (!(statement.left instanceof AST.Ident)) {
                this.error(statement.left.span, "must be identifier");
                return false;
            }

            const name = statement.left.span.link(file.src);
            const sym = scope.find(name);
            if (sym === undefined) {
                this.error(statement.left.span, "variable does not exist");
                return false;
            }

            if (sym instanceof IR.Unreachable) {
                return false;
            }

            if (sym instanceof UnresolvedFunctions || !sym.mut) {
                this.error(statement.left.span, "cannot assign to immutable variable");
                if (sym instanceof UnresolvedFunctions) {
                    return false;
                }
            }

            if (statement.right === null) {
                fn.body.push(new IR.LocalSet(sym, new IR.Unreachable(statement.span)));
                return false;
            }

            fn.body.push(
                new IR.LocalSet(
                    sym,
                    this.checkExpr(
                        new AST.Binary(
                            statement.span,
                            statement.kind,
                            statement.left,
                            statement.right
                        ),
                        dep,
                        sym.ty
                    )
                )
            );
            return false;
        } else if (statement instanceof AST.Return) {
            if (statement.expr === null) {
                return true;
            }

            let atom: AST.Atom;
            if (statement.expr === undefined) {
                atom = new AST.Product(statement.span, []);
            } else {
                atom = statement.expr;
            }

            const expr = this.checkExpr(atom, dep, fn.ty.ret);
            fn.body.push(new IR.Return(expr));
            return true;
        } else if (statement instanceof AST.FunctionDeclaration) {
            this.error(statement.span, "not yet supported");
            return false;
        } else {
            const expr = this.checkExpr(statement, dep, fn.ty.ret);
            fn.body.push(new IR.Drop(expr));
            return false;
        }
    }

    private checkExpr(atom: AST.Atom, dep: CompDep, ty?: IR.Type): IR.Expression {
        const virtualExpr = this.checkExprInner(atom, dep, ty);
        if (virtualExpr instanceof IR.VirtualInteger) {
            if (ty === undefined) {
                this.error(
                    atom.span,
                    "required type annotation (inferred " + virtualExpr.ty.print() + ")"
                );
                return new IR.Unreachable(atom.span);
            } else if (virtualExpr.ty.assignableTo(ty)) {
                if (ty instanceof IR.Product) {
                    // void, see note in VirtualIntegerTy.assignableTo
                    return IR.ProductCtr.void(virtualExpr.span, ty.span);
                } else if (IR.isIntegerTy(ty)) {
                    return new IR.Integer(virtualExpr.span, virtualExpr.value, ty);
                } else {
                    throw new Error();
                }
            } else {
                this.error(atom.span, "type mismatch (expression doesn't match context)");
                return new IR.Unreachable(atom.span);
            }
        } else if (virtualExpr instanceof IR.SingleFunction) {
            this.error(atom.span, "functions do not have a first-class representation");
            return new IR.Unreachable(atom.span);
        }
        return virtualExpr;
    }

    private callWithCoercion(
        span: Span,
        fn: IR.SingleFunction,
        args: IR.VirtualExpression[]
    ): IR.Call | IR.Unreachable {
        const coercedArgs = new Array(args.length);
        if (fn instanceof IR.SingleFunction) {
            const params = fn.ty.params;
            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                if (arg instanceof IR.VirtualInteger) {
                    const destTy = params[i];
                    if (arg.ty.assignableTo(destTy)) {
                        if (destTy instanceof IR.Product) {
                            // void, see note in VirtualIntegerTy.assignableTo
                            coercedArgs[i] = IR.ProductCtr.void(arg.span, destTy.span);
                        } else if (IR.isIntegerTy(destTy)) {
                            coercedArgs[i] = new IR.Integer(arg.span, arg.value, destTy);
                        } else {
                            throw new Error();
                        }
                    } else {
                        coercedArgs[i] = new IR.Unreachable(arg.span);
                    }
                } else {
                    coercedArgs[i] = arg;
                }
            }
            return new IR.Call(span, fn, coercedArgs, params[params.length - 1]);
        }
        return new IR.Unreachable(span);
    }

    // resulting expression is guaranteed to be assignable to ty
    private checkExprInner(
        atom: AST.Atom,
        dep: CompDep,
        ty?: IR.VirtualType
    ): IR.VirtualExpression {
        if (atom instanceof AST.Ascription) {
            if (atom.expr === null || atom.ty === null) {
                return new IR.Unreachable(atom.span);
            }
            const ty = this.ty(atom.ty);
            if (ty === null) {
                return new IR.Unreachable(atom.ty.span);
            }
            return this.checkExprInner(atom.expr, dep, ty);
        }

        if (atom instanceof AST.Call) {
            if (atom.base === null) {
                return new IR.Unreachable(atom.span);
            }
            const params = [];
            const args = [];
            for (const arg of atom.args) {
                if (arg === null) {
                    return new IR.Unreachable(atom.span);
                }
                const resolved = this.checkExprInner(arg, dep);
                args.push(resolved);
                params.push(resolved.ty);
            }
            const base = this.checkExprInner(
                atom.base,
                dep,
                new IR.Exponential(atom.span, false, params, ty ?? IR.Product.void(atom.span))
            );
            if (base instanceof IR.VirtualInteger) {
                throw new Error("shouldn't be possible");
            }
            if (base instanceof IR.SingleFunction) {
                return this.callWithCoercion(atom.span, base, args);
            } else if (!(base instanceof IR.Unreachable)) {
                this.error(base.span, "this expression is not callable");
            }
            return new IR.Unreachable(atom.span);
        } else if (atom instanceof AST.Binary) {
            if (atom.kind === AST.BinOp.Arrow) {
                this.error(atom.span, "invalid expression");
                return new IR.Unreachable(atom.span);
            }
            if (atom.left === null || atom.right === null) {
                return new IR.Unreachable(atom.span);
            }
            if (atom.kind === AST.BinOp.Id) {
                return this.checkExprInner(atom.right, dep, ty);
            }
            const name = AST.binOpToName.get(atom.kind);
            if (name === undefined) {
                throw new Error("unclassified op");
            }
            const args = [
                this.checkExprInner(atom.left, dep),
                this.checkExprInner(atom.right, dep)
            ];
            const params = args.map(v => v.ty);
            const virt = new IR.Exponential(
                atom.span,
                false,
                params,
                ty ?? IR.Product.void(atom.span)
            );
            const res = this.findImplementation(dep.scope, name, virt);
            if (res instanceof IR.Unreachable) {
                return new IR.Unreachable(atom.span);
            } else if (res === null) {
                throw new Error("operator name is local");
            } else if (res.length == 0) {
                this.error(atom.span, "no overload found (" + virt.print() + ")");
                return new IR.Unreachable(atom.span);
            } else if (res.length == 1) {
                return this.callWithCoercion(atom.span, res[0], args);
            } else {
                this.error(atom.span, "multiple overloads found");
                return new IR.Unreachable(atom.span);
            }
        } else if (atom instanceof AST.Unary) {
            if (atom.right === null) {
                return new IR.Unreachable(atom.span);
            }
            const name = AST.unOpToName.get(atom.kind);
            if (name === undefined) {
                throw new Error("unclassified op");
            }
            const args = [this.checkExprInner(atom.right, dep)];
            const params = args.map(v => v.ty);
            const res = this.findImplementation(
                dep.scope,
                name,
                new IR.Exponential(atom.span, false, params, ty ?? IR.Product.void(atom.span))
            );
            if (res instanceof IR.Unreachable) {
                return new IR.Unreachable(atom.span);
            } else if (res === null) {
                throw new Error("operator name is local");
            } else if (res.length == 0) {
                this.error(atom.span, "no overload found");
                return new IR.Unreachable(atom.span);
            } else if (res.length == 1) {
                return this.callWithCoercion(atom.span, res[0], args);
            } else {
                this.error(atom.span, "multiple overloads found");
                return new IR.Unreachable(atom.span);
            }
        } else if (atom instanceof AST.Ident) {
            const value = atom.span.link(dep.file.src);
            if (ty instanceof IR.Exponential) {
                const res = this.findImplementation(dep.scope, value, ty);
                if (res instanceof IR.Unreachable) {
                    return new IR.Unreachable(atom.span);
                } else if (res === null) {
                    this.error(atom.span, "identifier is not callable");
                    return new IR.Unreachable(atom.span);
                } else if (res.length == 0) {
                    this.error(atom.span, "no implementation found (" + ty.print() + ")");
                    return new IR.Unreachable(atom.span);
                } else if (res.length == 1) {
                    return res[0];
                } else {
                    this.error(atom.span, "multiple implementations found");
                    return new IR.Unreachable(atom.span);
                }
            } else {
                const res = dep.scope.find(value);
                if (res === undefined) {
                    this.error(atom.span, "no symbol found");
                    return new IR.Unreachable(atom.span);
                } else if (res instanceof IR.Unreachable) {
                    return new IR.Unreachable(atom.span);
                } else if (res instanceof IR.Local) {
                    if (ty !== undefined) {
                        if (IR.Product.isVoid(ty)) {
                            return IR.ProductCtr.void(atom.span, ty.span);
                        }
                        this.error(atom.span, "type mismatch (local doesn't match with context)");
                        return new IR.Unreachable(atom.span);
                    } else {
                        return new IR.LocalRef(atom.span, res, res.ty);
                    }
                } else if (res instanceof UnresolvedFunctions) {
                    this.error(atom.span, "type mismatch (functions in local context)");
                    return new IR.Unreachable(atom.span);
                } else {
                    unreachable(res);
                }
            }
        } else if (atom instanceof AST.IntegerLiteral) {
            const virtual = IR.VirtualInteger.fromValue(atom.span, atom.value);
            if (virtual === null) {
                this.error(atom.span, "literal too large");
                return new IR.Unreachable(atom.span);
            }
            if (ty !== undefined) {
                if (!IR.isIntegerTy(ty) || !virtual.ty.assignableTo(ty)) {
                    this.error(atom.span, "type mismatch (integer literal cannot fit context)");
                    return new IR.Unreachable(atom.span);
                }
                return new IR.Integer(atom.span, atom.value, ty);
            } else {
                return virtual;
            }
        } else if (atom instanceof AST.NumberLiteral) {
            if (!IR.isFloatTy(ty)) {
                return new IR.Unreachable(atom.span);
            }
            return new IR.Float(atom.span, atom.value, ty);
        } else if (
            atom instanceof AST.Mut ||
            atom instanceof AST.Pure ||
            atom instanceof AST.HeapTy ||
            atom instanceof AST.StackTy
        ) {
            this.error(atom.span, "invalid expression");
            return new IR.Unreachable(atom.span);
        } else if (
            atom instanceof AST.TypeCall ||
            atom instanceof AST.Product ||
            atom instanceof AST.StringLiteral
        ) {
            this.error(atom.span, "not yet supported");
            return new IR.Unreachable(atom.span);
        } else {
            return unreachable(atom);
        }
    }

    private findImplementation(
        scope: Scope,
        name: string,
        ty: IR.VirtualExponential
    ): IR.SingleFunction[] | IR.Unreachable | null {
        const sym = scope.getSameScope(name);
        if (sym !== undefined) {
            if (sym instanceof UnresolvedFunctions) {
                const resolvedSym = this.resolve(sym);
                if (resolvedSym instanceof IR.FunctionSum) {
                    const impls = [];
                    for (const fn of resolvedSym.impls) {
                        if (ty.assignableTo(fn.ty)) {
                            impls.push(fn);
                        }
                    }
                    if (impls.length > 0) {
                        return impls;
                    }
                } else if (resolvedSym instanceof IR.SingleFunction) {
                    if (ty.assignableTo(resolvedSym.ty)) {
                        return [resolvedSym];
                    }
                } else if (resolvedSym instanceof IR.Unreachable) {
                    return resolvedSym;
                } else {
                    unreachable(resolvedSym);
                }
            } else if (sym instanceof IR.Unreachable) {
                return sym;
            } else if (sym instanceof IR.Local) {
                return null;
            } else {
                unreachable(sym);
            }
        }
        return scope.parent ? this.findImplementation(scope.parent, name, ty) : [];
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
            return new IR.TypedPattern(span, new IR.UntypedPattern(span, mut, atom), ty);
        } else {
            this.error(span, "invalid pattern");
            return null;
        }
    }

    private ty(atom: AST.Atom, prohibitNever = false): IR.Type | null {
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
            if (prohibitNever) {
                this.error(atom.span, "`never` is not allowed here");
            }
            return new IR.Never(atom.span);
        }

        this.error(atom.span, "invalid type");
        return null;
    }

    private exponentialPred<Param extends IR.Type, Result extends IR.Type>(
        atom: AST.Binary & { kind: AST.BinOp.Arrow },
        predParam: (x: IR.Type) => x is Param,
        predResult: (x: IR.Type) => x is Result
    ): IR.Exponential<Param, Result> | null {
        // right associative
        if (atom.right === null) {
            return null;
        }
        const ret = this.ty(atom.right);
        if (ret === null || !predResult(ret)) {
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
            if (ty === null || !predParam(ty)) {
                return null;
            }
            params.push(ty);
        }
        return new IR.Exponential(atom.span, false, params, ret);
    }

    private exponential(atom: AST.Binary & { kind: AST.BinOp.Arrow }): IR.Exponential | null {
        return this.exponentialPred(atom, identityGuard, identityGuard);
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
            const newExp = this.exponential(possibleExp);
            if (newExp === null) {
                return null;
            }
            for (const exp of exponentials) {
                if (newExp.equals(exp)) {
                    this.error(
                        newExp.span,
                        "cannot have two of the same exponential type in the same sum type"
                    );
                    return null;
                }
            }
            exponentials.push(newExp);
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

export class CompDep {
    constructor(
        public file: Dep,
        public scope: Scope,
        public exported: Map<string, UnresolvedSym>
    ) {}
}

class Scope {
    constructor(public parent?: Scope, private variables: Map<string, Sym> = new Map()) {}

    public find(name: string): Sym | undefined {
        const match = this.variables.get(name);
        if (match !== undefined) {
            return match;
        }
        if (this.parent !== undefined) {
            return this.parent.find(name);
        }
        return undefined;
    }

    public getSameScope(name: string) {
        return this.variables.get(name);
    }

    public set(name: string, symbol: Sym) {
        this.variables.set(name, symbol);
    }

    public push() {
        this.parent = new Scope(this.parent, this.variables);
        this.variables = new Map();
    }

    public pop() {
        if (this.parent === undefined) {
            throw new Error("popped root scope");
        }
        this.variables = this.parent.variables;
        this.parent = this.parent.parent;
    }
}

type Sym = IR.Local | UnresolvedFunctions | IR.Unreachable;
type ResolvedSym = IR.FunctionSum | IR.SingleFunction | IR.Unreachable;
type UnresolvedSym = UnresolvedFunctions;

class UnresolvedFunctions {
    constructor(public items: AST.FunctionDeclaration[]) {}
}
