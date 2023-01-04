import { Dep } from ".";
import * as AST from "./ast.js";
import * as IR from "./ir.js";
import binaryen from "binaryen/index.js";
import System, { DiagnosticSeverity } from "./system.js";
import { Span } from "./lexer.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function unreachable(_x: never): never {
    throw new Error("unreachable");
}

export class CodeGen {
    private module = new binaryen.Module();

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

    constructor(private system: System, private program: IR.Program, private deps: Dep[]) {}

    public static run(system: System, program: IR.Program, deps: Dep[]): string {
        const codegen = new CodeGen(system, program, deps);
        for (const fn of program.contents) {
            if (fn instanceof IR.HostImport) {
                if (fn.ty instanceof IR.Never) {
                    throw new Error("todo"); // create dummy unreachable function
                } else {
                    codegen.module.addFunctionImport(
                        fn.internalName,
                        fn.moduleName,
                        fn.importFunctionName,
                        binaryen.createType(fn.ty.params.map(p => codegen.localType(p))),
                        codegen.result(fn.ty.ret)
                    );
                }
            } else if (fn instanceof IR.FunctionImpl) {
                codegen.compileFunction(fn);
            }
        }
        //codegen.module.optimize();
        codegen.module.validate();
        //if (!) throw new Error("validation error");
        return codegen.module.emitText();
    }

    private compileFunction(fn: IR.FunctionImpl) {
        this.module.addFunction(
            fn.internalName,
            binaryen.createType(fn.params.map(p => this.localType(p.ty))),
            this.result(fn.ty.ret),
            fn.locals.map(l => this.localType(l.ty)),
            this.functionBody(fn)
        );
        if (fn.host) {
            this.module.addFunctionExport(fn.internalName, fn.functionName);
        }
    }

    private result(result: IR.WASMResultType) {
        if (IR.Product.isVoid(result)) {
            return binaryen.none;
        } else if (result instanceof IR.StackTy) {
            return this.stackTy(result);
        } else if (result instanceof IR.Never) {
            return binaryen.unreachable;
        } else {
            unreachable(result);
        }
    }

    private localType(ty: IR.WASMStackType): binaryen.Type {
        if (ty instanceof IR.StackTy) {
            return this.stackTy(ty);
        } else if (ty instanceof IR.Never) {
            return binaryen.unreachable;
        } else {
            unreachable(ty);
        }
    }

    private stackTy(stackTy: IR.StackTy): binaryen.Type {
        switch (stackTy.value) {
            case AST.StackTyEnum.F32:
                return binaryen.f32;
            case AST.StackTyEnum.F64:
                return binaryen.f64;
            case AST.StackTyEnum.U32:
            case AST.StackTyEnum.I32:
                return binaryen.i32;
            case AST.StackTyEnum.U64:
            case AST.StackTyEnum.I64:
                return binaryen.i64;
        }
    }

    private functionBody(fn: IR.FunctionImpl): binaryen.ExpressionRef {
        return this.module.block(
            null,
            fn.body.map(stmt => {
                if (stmt instanceof IR.Drop) {
                    if (IR.Product.isVoid(stmt.expr.ty)) {
                        return this.expr(stmt.expr);
                    }
                    return this.module.drop(this.expr(stmt.expr));
                } else if (stmt instanceof IR.LocalSet) {
                    return this.module.local.set(stmt.local.idx, this.expr(stmt.expr));
                } else if (stmt instanceof IR.Return) {
                    return this.module.return(this.expr(stmt.expr));
                } else {
                    unreachable(stmt);
                }
            })
        );
    }

    private expr(expr: IR.Expression): binaryen.ExpressionRef {
        if (expr instanceof IR.Unreachable) {
            return this.module.unreachable();
        } else if (expr instanceof IR.LocalRef) {
            return this.module.local.get(expr.local.idx, this.localType(expr.ty));
        } else if (expr instanceof IR.Call) {
            return this.module.call(
                expr.fn.internalName,
                expr.args.map(e => this.expr(e)),
                this.result(expr.fn.ty.ret)
            );
        } else if (expr instanceof IR.Integer) {
            if (expr.ty instanceof IR.StackTy) {
                switch (expr.ty.value) {
                    case AST.StackTyEnum.U32:
                    case AST.StackTyEnum.I32:
                        return this.module.i32.const(Number(BigInt.asIntN(32, expr.value)));
                    case AST.StackTyEnum.U64:
                    case AST.StackTyEnum.I64: {
                        const value = BigInt.asIntN(64, expr.value);
                        const hi = value >> 32n;
                        const lo = value & ((1n << 33n) - 1n);
                        return this.module.i64.const(Number(lo), Number(hi));
                    }
                }
            } else if (expr.ty instanceof IR.HeapTy) {
                throw new Error("not supported");
            } else {
                unreachable(expr.ty);
            }
        } else if (expr instanceof IR.Float) {
            switch (expr.ty.value) {
                case AST.StackTyEnum.F32:
                    return this.module.f32.const(expr.value);
                case AST.StackTyEnum.F64:
                    return this.module.f64.const(expr.value);
            }
        } else if (expr instanceof IR.ProductCtr) {
            throw new Error("not supported");
        } else {
            unreachable(expr);
        }
    }
}
