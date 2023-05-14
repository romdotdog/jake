import { File } from ".";
import * as AST from "./ast.js";
import * as INT from "./intrinsics.js";
import * as IR from "./ir.js";
import { Span } from "./lexer.js";
import System, { DiagnosticSeverity } from "./system.js";

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
    private unit: Source[] = [];
    private symToResolvedSym: Map<UnresolvedSym, ResolvedSym> = new Map();
    private declToFunction: Map<AST.FunctionDeclaration, IR.FunctionImpl> = new Map();
    private resolutionStack: UnresolvedSym[] = [];
    private resolutionSet: Set<UnresolvedSym> = new Set();

    private error(span: Span, message: string) {
        span.assert();
        const file = this.files[span.idx];
        this.system.error(
            {
                path: file.path,
                span,
                message,
                severity: DiagnosticSeverity.Error
            },
            file.code
        );
    }

    private exportStage(unit: File[]) {
        for (const file of unit) {
            const scope: Map<string, UnresolvedSym> = new Map();
            const exported: Map<string, UnresolvedSym> = new Map();
            const source = new Source(file, new Scope(undefined, scope), exported);

            for (const item of file.ast.items) {
                // enumerate functions and add to scope
                if (item instanceof AST.FunctionDeclaration) {
                    const name = item.name.link(file.code);
                    this.addImpl(scope, name, item, source);
                    if (item.exported) {
                        this.addImpl(exported, name, item, source);
                    }
                } else {
                    const let_ = item.let_;
                    if (let_.pattern === null) {
                        continue;
                    }
                    const pattern = this.pattern(let_.pattern, file);
                    if (pattern === null) {
                        continue;
                    }
                    const name = pattern.untyped.ident.span.link(file.code);
                    scope.set(name, item);
                }
            }

            this.unit.push(source);
            this.idxToSource.set(file.idx, source);
        }
    }

    private addImpl(
        scope: Map<string, UnresolvedSym>,
        name: string,
        item: AST.FunctionDeclaration | IR.HostImport,
        source: Source
    ) {
        const sym = scope.get(name);
        if (sym !== undefined) {
            if (sym instanceof AST.Global) {
                this.error(item.span, "global already exists by this name");
            } else {
                sym.items.push(item);
            }
        } else {
            scope.set(name, new UnresolvedFunctions(source, [item]));
        }
    }

    private importStage() {
        for (const source of this.unit) {
            const { file, scope } = source;
            const importIdx = file.imports;
            const imports = file.ast.imports;
            for (let i = 0; i < importIdx.length; i++) {
                const import_ = imports[i];
                const importFile = importIdx[i];
                if (importFile === undefined) {
                    this.error(import_.path.span, "unable to open file");
                    // TODO: never the import
                    continue;
                }
                const idx = importFile.idx;
                const importSource = this.idxToSource.get(idx);
                if (importSource === undefined) {
                    throw new Error("imported an unresolved module");
                }
                for (const item of import_.with_) {
                    const originalName = item[0].link(file.code);
                    const newName = item[1].link(file.code);
                    const sym: UnresolvedSym | undefined = importSource.exported.get(originalName);
                    if (sym) {
                        const nativeSym = scope.find(newName);
                        if (nativeSym) {
                            if (sym instanceof UnresolvedFunctions && nativeSym instanceof UnresolvedFunctions) {
                                Array.prototype.push.apply(nativeSym.items, sym.items);
                            } else {
                                scope.set(newName, new IR.Unreachable(item[1]));
                                this.error(item[1], "cannot use this name");
                            }
                        } else if (sym instanceof AST.Global) {
                            scope.set(newName, sym);
                        } else {
                            scope.set(newName, new UnresolvedFunctions(source, sym.items.slice()));
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
                const name = hostImport.name.link(file.code);
                const ty = this.resolveHostImportTy(hostImport, file);
                if (ty === null) {
                    scope.set(name, new IR.Unreachable(hostImport.span));
                    continue;
                }
                const resolvedImport = new IR.HostImport(
                    hostImport.span,
                    IR.labelize(`${file.path}/${name}_${ty.print()}`),
                    moduleName,
                    functionName,
                    name,
                    ty
                );
                this.program.contents.push(resolvedImport);
                const sym = scope.find(name);
                if (sym !== undefined) {
                    if (sym instanceof UnresolvedFunctions) {
                        sym.items.push(resolvedImport);
                    } else {
                        scope.set(name, new IR.Unreachable(hostImport.name));
                        this.error(hostImport.name, "cannot use this name");
                    }
                } else {
                    scope.set(name, new UnresolvedFunctions(source, [resolvedImport]));
                }
            }
        }
    }

    private resolveHostImportTy(hostImport: AST.HostImport, file: File) {
        if (hostImport.ty !== null) {
            if (hostImport.ty instanceof AST.Binary && isExponential(hostImport.ty)) {
                return this.exponentialWithFilter(
                    hostImport.ty,
                    (param: IR.Type): param is IR.WASMStackType => {
                        if (param instanceof IR.StackTy || param instanceof IR.Never) {
                            return true;
                        }
                        this.error(hostImport.span, "not allowed");
                        return false;
                    },
                    (result: IR.Type): result is IR.WASMResultType => {
                        if (result instanceof IR.StackTy || result instanceof IR.Never || IR.Product.isVoid(result)) {
                            return true;
                        }
                        this.error(hostImport.span, "not allowed");
                        return false;
                    },
                    file
                );
            } else {
                this.error(hostImport.span, "type of host import must be exponential");
            }
        }
        return null;
    }

    constructor(
        private system: System,
        private program: IR.Program,
        private idxToSource: Map<number, Source>,
        public files: File[]
    ) {}

    public run(unit: File[]) {
        this.exportStage(unit);
        this.importStage();

        for (const source of this.unit) {
            source.scope.push();
            for (const item of source.exported.values()) {
                this.resolve(item, this.unsafeResolve);
            }
        }
    }

    private resolve<U extends UnresolvedSym, R extends ResolvedSym>(sym: U, f: (this: Checker, sym: U) => R): R {
        const cached = this.symToResolvedSym.get(sym);
        if (cached) {
            return cached as R; // assuming that there is only one f per U
        }

        if (this.resolutionSet.has(sym)) {
            throw new Error("resolution cycle");
        }

        this.addToResolutionStack(sym);
        const local = f.call(this, sym);
        this.popResolutionStack();

        this.symToResolvedSym.set(sym, local);
        return local;
    }

    private unsafeResolve(sym: UnresolvedSym): ResolvedSym {
        if (sym instanceof AST.Global) {
            return this.unsafeResolveGlobal(sym);
        }
        return this.unsafeResolveFunctions(sym);
    }

    private unsafeResolveGlobal(global: AST.Global): IR.Global | IR.Unreachable {
        const source = this.idxToSource.get(global.span.idx);
        if (source === undefined) {
            throw new Error("couldn't find source");
        }

        const let_ = this.resolveLet(global.let_, source);
        if (let_ instanceof Span) {
            this.program.addStartStatement(IR.Unreachable.drop(let_));
            return new IR.Unreachable(let_);
        } else {
            const { name, mut, ty, expr } = let_;
            let host = global.host;
            if (host) {
                if (this.program.exportMap.has(name)) {
                    this.error(global.span, "an item with this name is already host");
                    host = false;
                } else {
                    this.program.exportMap.add(name);
                }
            }

            const internalName = IR.labelize(`${source.file.path}/${name}_${ty.print()}`);
            const globalIR = new IR.Global(internalName, name, host, mut, ty);
            this.program.globals.push(globalIR);
            this.program.addStartStatement(new IR.GlobalSet(globalIR, expr));
            return globalIR;
        }
    }

    private resolveIfFnDecl(fn: AST.FunctionDeclaration | IR.HostImport) {
        if (fn instanceof AST.FunctionDeclaration) {
            return this.resolveFunction(fn);
        } else {
            return fn;
        }
    }

    private unsafeResolveFunctions(
        sym: UnresolvedFunctions
    ): IR.HostImport | IR.FunctionImpl | IR.FunctionSum | IR.Unreachable {
        if (sym.items.length == 1) {
            return this.resolveIfFnDecl(sym.items[0]);
        }

        let name = "";
        const fns: IR.Fn[] = [];
        const exponentials: IR.Exponential[] = [];
        for (const fn of sym.items) {
            const resolvedFn = this.resolveIfFnDecl(fn);
            if (resolvedFn instanceof IR.Unreachable) {
                return new IR.Unreachable(sym.items[0].span);
            }
            name ||= resolvedFn.name;
            for (const exp of exponentials) {
                if (resolvedFn.ty.equals(exp)) {
                    this.error(fn.span, "conflicting implementations");
                    return new IR.Unreachable(fn.span);
                }
            }
            fns.push(resolvedFn);
            exponentials.push(resolvedFn.ty);
        }

        return new IR.FunctionSum(name, fns, new IR.ExponentialSum(exponentials[0].span, exponentials));
    }

    private resolveFunction(item: AST.FunctionDeclaration): IR.FunctionImpl | IR.Unreachable {
        const cached = this.declToFunction.get(item);
        if (cached) {
            return cached;
        }

        if (item.sig.ty !== undefined) {
            this.error(item.span, "polymorphism is not yet supported");
            return new IR.Unreachable(item.span);
        }

        const source = this.idxToSource.get(item.span.idx);
        if (source === undefined) {
            throw new Error("couldn't find source");
        }

        const paramTys: IR.WASMResultType[] = [];
        const params = [];
        for (const param of item.sig.params) {
            if (param === null) {
                return new IR.Unreachable(item.span);
            }
            const pattern = this.pattern(param, source.file);
            if (pattern === null) {
                return new IR.Unreachable(param.span);
            }

            const ty = pattern.ty;
            if (ty instanceof IR.ExponentialSum || ty instanceof IR.Exponential || ty instanceof IR.Product) {
                this.error(pattern.ty.span, "inlining is not yet supported");
                return new IR.Unreachable(param.span);
            }

            if (ty instanceof IR.HeapTy) {
                this.error(pattern.ty.span, "heap types cannot exist on the stack");
                return new IR.Unreachable(param.span);
            }

            paramTys.push(ty);
            const name = pattern.untyped.ident.span.link(source.file.code);
            params.push(new IR.Local(params.length, name, pattern.untyped.mut, ty));
        }
        if (paramTys.length == 0) {
            paramTys.push(IR.Product.void(item.span));
        }

        let returnTy: IR.Type;
        const returnTyAtom = item.sig.returnTy;
        switch (returnTyAtom) {
            case undefined:
                this.error(item.span, "type inference is not yet supported");
            // fallthrough
            case null:
                return new IR.Unreachable(item.span);
            default: {
                const resolvedTy = this.ty(returnTyAtom, source.file);
                if (resolvedTy === null) {
                    return new IR.Unreachable(item.span);
                }
                returnTy = resolvedTy;
            }
        }

        if (
            returnTy instanceof IR.ExponentialSum ||
            returnTy instanceof IR.Exponential ||
            (returnTy instanceof IR.Product && !IR.Product.isVoid(returnTy))
        ) {
            this.error(returnTy.span, "inlining is not yet supported");
            return new IR.Unreachable(returnTy.span);
        }

        if (returnTy instanceof IR.HeapTy) {
            this.error(returnTy.span, "heap types cannot exist on the stack");
            return new IR.Unreachable(returnTy.span);
        }

        const ty = new IR.Exponential(item.span, false, paramTys, returnTy);
        const name = item.sig.name.link(source.file.code);

        if (name === "cast" && ty.params.length !== 1) {
            this.error(item.span, "cast overloads must take exactly one parameter");
            return new IR.Unreachable(item.span);
        }

        const binOp = AST.nameToBinOp.get(name);
        if (binOp && ty.params.length !== 2) {
            this.error(item.span, "binary operator overloads must take exactly two parameters");
            return new IR.Unreachable(item.span);
        }

        const unOp = AST.nameToUnOp.get(name);
        if (unOp && ty.params.length !== 1) {
            this.error(item.span, "unary operator overloads must take exactly one parameter");
            return new IR.Unreachable(item.span);
        }

        let host = item.host;
        if (host) {
            if (this.program.exportMap.has(name)) {
                this.error(item.span, "an item with this name is already host");
                host = false;
            } else if (
                name === "_start" &&
                !(ty.params.length == 1 && IR.Product.isVoid(ty.params[0]) && IR.Product.isVoid(ty.ret))
            ) {
                this.error(item.span, "_start functions must have the signature `void -> void`");
                host = false;
            } else {
                this.program.exportMap.add(name);
            }
        }

        const internalName = IR.labelize(`${source.file.path}/${name}_${ty.print()}`);
        const fn = new IR.FunctionImpl(internalName, name, host, ty, params, [], []);
        let success = false;
        if (item.body !== null) {
            if (Array.isArray(item.body)) {
                this.resolveBody(fn, item.body, source);
                success = true;
            } else {
                const intrinsic = this.resolveIntrinsic(item.body, source.file);

                if (intrinsic instanceof INT.Namespace) {
                    this.error(item.body.span, "expected intrinsic, got namespace");
                } else if (intrinsic instanceof INT.Intrinsic) {
                    if (intrinsic.sig.assignableTo(ty)) {
                        success = true;
                        fn.body.push(
                            new IR.Return(
                                new IR.IntrinsicCall(
                                    item.span,
                                    intrinsic,
                                    params.map(p => new IR.LocalRef(item.span, p, p.ty)),
                                    ty.ret
                                )
                            )
                        );
                    } else {
                        this.error(item.body.span, "signature is not assignable to intrinsic");
                    }
                }
            }
        }

        if (!success) {
            fn.body.push(new IR.Return(new IR.Unreachable(item.span)));
        }

        this.declToFunction.set(item, fn);
        this.program.contents.push(fn);
        return fn;
    }

    private resolveBody(fn: IR.FunctionImpl, body: AST.Statement[], source: Source) {
        const { file, scope } = source;
        scope.push();
        for (const param of fn.params) {
            scope.set(param.name, param);
        }
        let needsReturn = true;
        for (const statement of body) {
            if (this.resolveStatement(fn.body, fn, statement, source)) {
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

    private resolveLet(
        statement: AST.Let,
        source: Source
    ): { name: string; mut: boolean; ty: IR.WASMStackType; expr: IR.Expression } | Span {
        if (statement.pattern === null) {
            return statement.span;
        }
        const pattern = this.pattern(statement.pattern, source.file);
        if (pattern === null) {
            return statement.pattern.span;
        }

        const name = pattern.untyped.ident.span.link(source.file.code);
        const mut = pattern.untyped.mut;
        const ty = pattern.ty;
        const isUnsupported =
            ty instanceof IR.ExponentialSum || ty instanceof IR.Exponential || ty instanceof IR.Product;
        const isHeapTy = ty instanceof IR.HeapTy;

        if (statement.expr === null || isUnsupported || isHeapTy) {
            if (isUnsupported) {
                if (pattern.untyped.mut) {
                    this.error(pattern.ty.span, "mutable locals cannot have this type");
                } else {
                    this.error(pattern.ty.span, "TODO: constant propagation");
                }
            } else if (isHeapTy) {
                this.error(pattern.ty.span, "heap types cannot exist on the stack");
            }
            return { name, mut, ty: new IR.Never(statement.span), expr: new IR.Unreachable(statement.span) };
        }

        return { name, mut, ty, expr: this.checkExpr(statement.expr, source, pattern.ty) };
    }

    private resolveStatement(
        body: IR.Statement[],
        fn: IR.FunctionImpl,
        statement: AST.Statement,
        source: Source
    ): boolean {
        const { file, scope } = source;
        if (statement instanceof AST.Let) {
            const let_ = this.resolveLet(statement, source);
            if (let_ instanceof Span) {
                body.push(IR.Unreachable.drop(let_));
            } else {
                const { name, mut, ty, expr } = let_;
                const local = fn.addLocal(name, mut, ty);
                scope.set(name, local);
                body.push(new IR.LocalSet(local, expr));
            }
            return false;
        } else if (statement instanceof AST.Assign) {
            if (statement.left === null) {
                return false;
            }

            if (!(statement.left instanceof AST.Ident)) {
                this.error(statement.left.span, "must be identifier");
                return false;
            }

            const name = statement.left.span.link(file.code);
            const sym = scope.find(name);
            if (sym === undefined) {
                this.error(statement.left.span, "variable does not exist");
                return false;
            }

            if (sym instanceof IR.Unreachable) {
                return false;
            }

            let mut = false;
            let variable: IR.Local | IR.Global | null = null;
            if (sym instanceof AST.Global) {
                const resolved = this.resolve(sym, this.unsafeResolveGlobal);
                if (resolved instanceof IR.Unreachable) {
                    return false;
                }
                variable = resolved;
                mut = variable.mut;
            } else if (sym instanceof IR.Local) {
                variable = sym;
                mut = variable.mut;
            }

            if (!mut) {
                this.error(statement.left.span, "cannot assign to immutable variable");
            }

            if (variable === null) {
                return false;
            }

            if (statement.right === null) {
                const expr = new IR.Unreachable(statement.span);
                if (variable instanceof IR.Local) {
                    body.push(new IR.LocalSet(variable, expr));
                } else {
                    body.push(new IR.GlobalSet(variable, expr));
                }
                return false;
            }

            const expr = this.checkExpr(
                new AST.Binary(statement.span, statement.kind, statement.left, statement.right),
                source,
                variable.ty
            );

            if (variable instanceof IR.Local) {
                body.push(new IR.LocalSet(variable, expr));
            } else {
                body.push(new IR.GlobalSet(variable, expr));
            }
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

            const expr = this.checkExpr(atom, source, fn.ty.ret);
            body.push(new IR.Return(expr));
            return true;
        } else if (statement instanceof AST.If) {
            if (statement.cond === null) {
                return false;
            }
            const cond = this.checkExpr(
                statement.cond,
                source,
                new IR.StackTy(statement.cond.span, IR.StackTyEnum.I32)
            );
            const innerBody: IR.Statement[] = [];

            let firstBranchReturns = false;
            scope.push();
            for (const innerStatement of statement.body) {
                if (this.resolveStatement(innerBody, fn, innerStatement, source)) {
                    firstBranchReturns = true;
                    break;
                }
            }
            scope.pop();

            let secondBranchReturns = false;
            let elseStatements: AST.Statement[];
            if (statement.else_ === undefined) {
                elseStatements = [];
            } else if (statement.else_ instanceof AST.If) {
                elseStatements = [statement.else_];
            } else {
                elseStatements = statement.else_;
            }

            const innerElse: IR.Statement[] = [];
            scope.push();
            for (const innerStatement of elseStatements) {
                if (this.resolveStatement(innerElse, fn, innerStatement, source)) {
                    secondBranchReturns = true;
                    break;
                }
            }
            scope.pop();

            body.push(new IR.If(cond, innerBody, innerElse));
            return firstBranchReturns && secondBranchReturns;
        } else if (statement instanceof AST.FunctionDeclaration || statement instanceof AST.Global) {
            this.error(statement.span, "not yet supported");
            // TODO: caught not nevering here, waiting for code coverage policy
            return false;
        } else {
            const expr = this.checkExpr(statement, source, fn.ty.ret);
            body.push(new IR.Drop(expr));
            return false;
        }
    }

    private resolveIntrinsic(atom: AST.Atom, file: File): INT.Namespace | INT.Intrinsic | null {
        let base: INT.Namespace | INT.Intrinsic | null;
        let index: string;
        if (atom instanceof AST.Ident) {
            base = INT.root;
            index = atom.span.link(file.code);
        } else if (atom instanceof AST.Field) {
            if (atom.expr === null) {
                return null;
            }
            base = this.resolveIntrinsic(atom.expr, file);
            index = atom.ident.span.link(file.code);
        } else {
            this.error(atom.span, "invalid path to intrinsic");
            return null;
        }
        if (base instanceof INT.Namespace) {
            const res = base.contents.get(index);
            if (res === undefined) {
                this.error(atom.span, "field does not exist");
                return null;
            } else {
                return res;
            }
        } else if (base instanceof INT.Intrinsic) {
            this.error(atom.span, "attempt to index intrinsic");
            return null;
        }
        return null;
    }

    private checkExpr(atom: AST.Atom, source: Source, ty?: IR.Type): IR.Expression {
        const virtualExpr = this.checkExprInner(atom, source, ty);
        if (virtualExpr instanceof IR.VirtualInteger) {
            if (ty === undefined) {
                this.error(atom.span, "required type annotation (inferred " + virtualExpr.ty.print() + ")");
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
        } else if (virtualExpr instanceof IR.FunctionImpl || virtualExpr instanceof IR.HostImport) {
            this.error(atom.span, "functions do not have a first-class representation");
            return new IR.Unreachable(atom.span);
        }
        return virtualExpr;
    }

    private callWithCoercion(span: Span, fn: IR.Fn, args: IR.VirtualExpression[]): IR.Call | IR.Unreachable {
        const coercedArgs = new Array(args.length);
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg instanceof IR.VirtualInteger) {
                const destTy = fn.ty.params[i];
                if (arg.ty.assignableTo(destTy)) {
                    if (destTy instanceof IR.Product) {
                        // void, see note in VirtualIntegerTy.assignableTo
                        coercedArgs[i] = IR.ProductCtr.void(arg.span, destTy.span);
                    } else if (IR.isIntegerTy(destTy)) {
                        coercedArgs[i] = new IR.Integer(arg.span, arg.value, destTy);
                    } else {
                        // TODO: coercion to f32 (Math.fround)
                        throw new Error();
                    }
                } else {
                    coercedArgs[i] = new IR.Unreachable(arg.span);
                }
            } else {
                coercedArgs[i] = arg;
            }
        }
        return new IR.Call(span, fn, coercedArgs, fn.ty.ret);
    }

    // resulting expression is guaranteed to be assignable to ty
    private checkExprInner(atom: AST.Atom, source: Source, ty?: IR.VirtualType): IR.VirtualExpression {
        if (atom instanceof AST.Ascription) {
            if (atom.expr === null || atom.ty === null) {
                return new IR.Unreachable(atom.span);
            }
            const ty = this.ty(atom.ty, source.file);
            if (ty === null) {
                return new IR.Unreachable(atom.ty.span);
            }
            return this.checkExprInner(atom.expr, source, ty);
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
                const resolved = this.checkExprInner(arg, source);
                args.push(resolved);
                params.push(resolved.ty);
            }
            const base = this.checkExprInner(
                atom.base,
                source,
                new IR.Exponential(atom.span, false, params, ty ?? IR.Product.void(atom.span))
            );
            if (base instanceof IR.VirtualInteger) {
                throw new Error("shouldn't be possible");
            }
            if (base instanceof IR.FunctionImpl || base instanceof IR.HostImport) {
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
                return this.checkExprInner(atom.right, source, ty);
            }
            const name = AST.binOpToName.get(atom.kind);
            if (name === undefined) {
                throw new Error("unclassified op");
            }
            const args = [this.checkExprInner(atom.left, source), this.checkExprInner(atom.right, source)];
            const params = args.map(v => v.ty);
            const virt = new IR.Exponential(atom.span, false, params, ty ?? IR.Product.void(atom.span));
            const res: IR.Unreachable | IR.Fn[] | null = this.findImplementation(source.scope, name, virt);
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
            const args = [this.checkExprInner(atom.right, source)];
            const params = args.map(v => v.ty);
            const res: IR.Unreachable | IR.Fn[] | null = this.findImplementation(
                source.scope,
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
            const value = atom.span.link(source.file.code);
            if (ty instanceof IR.Exponential) {
                const res: IR.Unreachable | IR.Fn[] | null = this.findImplementation(source.scope, value, ty);
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
                const res: IR.Local | AST.Global | UnresolvedFunctions | IR.Unreachable | undefined =
                    source.scope.find(value);
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
                        if (res.ty.assignableTo(ty)) {
                            return new IR.LocalRef(atom.span, res, res.ty);
                        }
                        this.error(atom.span, "type mismatch (local doesn't match with context)");
                        return new IR.Unreachable(atom.span);
                    } else {
                        return new IR.LocalRef(atom.span, res, res.ty);
                    }
                } else if (res instanceof AST.Global) {
                    // TODO: merge
                    const resolved = this.unsafeResolveGlobal(res);
                    if (resolved instanceof IR.Unreachable) {
                        return new IR.Unreachable(atom.span);
                    }
                    if (ty !== undefined) {
                        if (IR.Product.isVoid(ty)) {
                            return IR.ProductCtr.void(atom.span, ty.span);
                        }
                        if (resolved.ty.assignableTo(ty)) {
                            return new IR.GlobalRef(atom.span, resolved, resolved.ty);
                        }
                        this.error(atom.span, "type mismatch (local doesn't match with context)");
                        return new IR.Unreachable(atom.span);
                    } else {
                        return new IR.GlobalRef(atom.span, resolved, resolved.ty);
                    }
                } else {
                    this.error(atom.span, "type mismatch (functions in local context)");
                    return new IR.Unreachable(atom.span);
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
            // TODO: coercion to f32 (Math.fround)
            if (!IR.isFloatTy(ty)) {
                return new IR.Unreachable(atom.span);
            }
            return new IR.Float(atom.span, atom.value, ty);
        } else if (atom instanceof AST.Mut || atom instanceof AST.Pure) {
            this.error(atom.span, "invalid expression");
            return new IR.Unreachable(atom.span);
        } else if (atom instanceof AST.Cast) {
            if (atom.expr === null || atom.ty === null) {
                return new IR.Unreachable(atom.span);
            }
            const ty = this.ty(atom.ty, source.file);
            if (ty === null) {
                return new IR.Unreachable(atom.ty.span);
            }
            const arg = this.checkExprInner(atom.expr, source);
            const res: IR.Unreachable | IR.Fn[] | null = this.findImplementation(
                source.scope,
                "cast",
                new IR.Exponential(atom.span, false, [arg.ty], ty)
            );
            if (res instanceof IR.Unreachable) {
                return new IR.Unreachable(atom.span);
            } else if (res === null) {
                throw new Error("operator name is local");
            } else if (res.length == 0) {
                this.error(atom.span, "no cast overloads found");
                return new IR.Unreachable(atom.span);
            } else if (res.length == 1) {
                if (ty && !res[0].ty.ret.assignableTo(ty)) {
                    this.error(atom.span, "type mismatch (cast does not match with context)");
                    return new IR.Unreachable(atom.span);
                }
                return this.callWithCoercion(atom.span, res[0], [arg]);
            } else {
                this.error(atom.span, "multiple cast overloads found");
                return new IR.Unreachable(atom.span);
            }
        } else if (
            atom instanceof AST.TypeCall ||
            atom instanceof AST.Product ||
            atom instanceof AST.StringLiteral ||
            atom instanceof AST.Field
        ) {
            this.error(atom.span, "not yet supported");
            return new IR.Unreachable(atom.span);
        }
        return atom;
    }

    private findImplementation(scope: Scope, name: string, ty: IR.VirtualExponential): IR.Fn[] | IR.Unreachable | null {
        const sym: UnresolvedFunctions | AST.Global | IR.Unreachable | IR.Local | undefined = scope.getSameScope(name);
        if (sym !== undefined) {
            if (sym instanceof UnresolvedFunctions) {
                const resolvedSym: IR.FunctionSum | IR.Fn | IR.Unreachable = this.resolve(
                    sym,
                    this.unsafeResolveFunctions
                );
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
                } else if (resolvedSym instanceof IR.FunctionImpl || resolvedSym instanceof IR.HostImport) {
                    if (ty.assignableTo(resolvedSym.ty)) {
                        return [resolvedSym];
                    }
                } else {
                    return resolvedSym;
                }
            } else if (sym instanceof IR.Unreachable) {
                return sym;
            } else {
                return null;
            }
        }
        return scope.parent ? this.findImplementation(scope.parent, name, ty) : [];
    }

    private pattern(atom: AST.Atom, file: File): IR.Pattern | null {
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
                const resolvedTy = this.ty(atom.ty, file);
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

    private ty(atom: AST.Atom, file: File, prohibitNever = false): IR.Type | null {
        if (atom instanceof AST.Binary) {
            if (isExponential(atom)) {
                return this.exponential(atom, file);
            } else if (isSum(atom)) {
                return this.sum(atom, file);
            }
        }

        if (atom instanceof AST.Product) {
            const fields = [];
            for (const field of atom.fields) {
                if (field === null) {
                    return null;
                }
                const ty = this.ty(field, file);
                if (ty === null) {
                    return null;
                } else {
                    fields.push(ty);
                }
            }
            return new IR.Product(atom.span, fields);
        }

        if (atom instanceof AST.Ident) {
            const text = atom.span.link(file.code);
            const maybeStackTy = stackTy.get(text);
            if (maybeStackTy !== undefined) {
                return new IR.StackTy(atom.span, maybeStackTy);
            }
            const maybeHeapTy = heapTy.get(text);
            if (maybeHeapTy !== undefined) {
                return new IR.HeapTy(atom.span, maybeHeapTy);
            }
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

    private exponentialWithFilter<Param extends IR.Type, Result extends IR.Type>(
        atom: AST.Binary & { kind: AST.BinOp.Arrow },
        paramFilter: (x: IR.Type) => x is Param,
        resultFilter: (x: IR.Type) => x is Result,
        file: File
    ): IR.Exponential<Param, Result> | null {
        // right associative
        if (atom.right === null) {
            return null;
        }
        const ret = this.ty(atom.right, file);
        if (ret === null || !resultFilter(ret)) {
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

            const ty = this.ty(possibleExp, file);
            if (ty === null || !paramFilter(ty)) {
                return null;
            }
            params.push(ty);
        }
        return new IR.Exponential(atom.span, false, params, ret);
    }

    private exponential(atom: AST.Binary & { kind: AST.BinOp.Arrow }, file: File): IR.Exponential | null {
        return this.exponentialWithFilter(atom, identityGuard, identityGuard, file);
    }

    private sum(atom: AST.Binary & { kind: AST.BinOp.Or }, file: File): IR.ExponentialSum | null {
        if (!(atom.left instanceof AST.Binary) || !isExponential(atom.left)) {
            this.error(atom.span, "sum types not yet supported");
            return null;
        }

        const initialTy = this.exponential(atom.left, file);
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
                this.error(possibleExp.span, "cannot mix sum exponential types and sum types; use parentheses");
                return null;
            }
            const newExp = this.exponential(possibleExp, file);
            if (newExp === null) {
                return null;
            }
            for (const exp of exponentials) {
                if (newExp.equals(exp)) {
                    this.error(newExp.span, "cannot have two of the same exponential type in the same sum type");
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

export class Source {
    constructor(public file: File, public scope: Scope, public exported: Map<string, UnresolvedSym>) {}
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

type Sym = IR.Local | UnresolvedSym | IR.Unreachable;
type ResolvedSym = IR.Global | IR.FunctionSum | IR.Fn | IR.Unreachable;
type UnresolvedSym = AST.Global | UnresolvedFunctions;

class UnresolvedFunctions {
    constructor(public source: Source, public items: Array<AST.FunctionDeclaration | IR.HostImport>) {}
}

const heapTy = new Map([
    ["i8", IR.HeapTyEnum.I8],
    ["u8", IR.HeapTyEnum.U8],
    ["i16", IR.HeapTyEnum.I16],
    ["u16", IR.HeapTyEnum.U16]
]);

const stackTy = new Map([
    ["i32", IR.StackTyEnum.I32],
    ["u32", IR.StackTyEnum.U32],
    ["f32", IR.StackTyEnum.F32],
    ["i64", IR.StackTyEnum.I64],
    ["u64", IR.StackTyEnum.U64],
    ["f64", IR.StackTyEnum.F64]
]);
