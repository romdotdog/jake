import { File } from ".";
import * as IR from "./ir.js";
import * as INT from "./intrinsics.js";
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

    constructor(private system: System, private program: IR.Program, private files: File[]) {}

    public static run(system: System, program: IR.Program, files: File[]): string {
        const codegen = new CodeGen(system, program, files);
        for (const global of program.globals) {
            const ty = codegen.localType(global.ty);
            codegen.module.addGlobal(global.internalName, ty, true, codegen.zero(ty));
            if (global.host) {
                codegen.module.addGlobalExport(global.internalName, global.name);
            }
        }

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
            } else {
                unreachable(fn);
            }
        }
        //codegen.module.optimize();
        codegen.module.setFeatures(binaryen.Features.MutableGlobals | binaryen.Features.SignExt);
        codegen.module.validate();
        //if (!) throw new Error("validation error");
        return codegen.module.emitText();
    }

    private zero(ty: binaryen.Type): binaryen.ExpressionRef {
        switch (ty) {
            case binaryen.f32:
                return this.module.f32.const(0);
            case binaryen.f64:
                return this.module.f64.const(0);
            case binaryen.i32:
                return this.module.i32.const(0);
            case binaryen.i64:
                return this.module.i64.const(0, 0);
            case binaryen.unreachable:
                return this.module.unreachable();
        }
        throw new Error();
    }

    private compileFunction(fn: IR.FunctionImpl) {
        this.module.addFunction(
            fn.internalName,
            binaryen.createType(fn.params.map(p => this.localType(p.ty))),
            this.result(fn.ty.ret),
            fn.locals.map(l => this.localType(l.ty)),
            this.body(fn.body)
        );
        if (fn.host) {
            if (fn.name === "_start" && this.program._start && fn !== this.program._start) {
                const _start = this.program._start;
                _start.body.push(new IR.Drop(new IR.Call(_start.ty.span, fn, [], fn.ty.ret)));
                this.compileFunction(_start);
            } else {
                this.module.addFunctionExport(fn.internalName, fn.name);
            }
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
            case IR.StackTyEnum.F32:
                return binaryen.f32;
            case IR.StackTyEnum.F64:
                return binaryen.f64;
            case IR.StackTyEnum.U32:
            case IR.StackTyEnum.I32:
                return binaryen.i32;
            case IR.StackTyEnum.U64:
            case IR.StackTyEnum.I64:
                return binaryen.i64;
        }
    }

    private body(body: IR.Statement[]): binaryen.ExpressionRef {
        return this.module.block(
            null,
            body.map(stmt => {
                if (stmt instanceof IR.Drop) {
                    if (IR.Product.isVoid(stmt.expr.ty)) {
                        return this.expr(stmt.expr);
                    }
                    return this.module.drop(this.expr(stmt.expr));
                } else if (stmt instanceof IR.LocalSet) {
                    return this.module.local.set(stmt.local.idx, this.expr(stmt.expr));
                } else if (stmt instanceof IR.GlobalSet) {
                    return this.module.global.set(stmt.global.internalName, this.expr(stmt.expr));
                } else if (stmt instanceof IR.Return) {
                    return this.module.return(this.expr(stmt.expr));
                } else if (stmt instanceof IR.If) {
                    return this.module.if(this.expr(stmt.cond), this.body(stmt.body), this.body(stmt.else_));
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
        } else if (expr instanceof IR.GlobalRef) {
            return this.module.global.get(expr.global.internalName, this.localType(expr.ty));
        } else if (expr instanceof IR.Call) {
            return this.module.call(
                expr.fn.internalName,
                expr.args.map(e => this.expr(e)),
                this.result(expr.fn.ty.ret)
            );
        } else if (expr instanceof IR.Integer) {
            if (expr.ty instanceof IR.StackTy) {
                switch (expr.ty.value) {
                    case IR.StackTyEnum.U32:
                    case IR.StackTyEnum.I32:
                        return this.module.i32.const(Number(BigInt.asIntN(32, expr.value)));
                    case IR.StackTyEnum.U64:
                    case IR.StackTyEnum.I64: {
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
                case IR.StackTyEnum.F32:
                    return this.module.f32.const(expr.value);
                case IR.StackTyEnum.F64:
                    return this.module.f64.const(expr.value);
            }
        } else if (expr instanceof IR.ProductCtr) {
            throw new Error("not supported");
        } else if (expr instanceof IR.IntrinsicCall) {
            const impl = this.intrinsicImpls.get(expr.intrinsic);
            if (impl === undefined) {
                throw new Error();
            } else {
                return impl.apply(
                    this.module,
                    expr.args.map(e => this.expr(e))
                );
            }
        } else {
            unreachable(expr);
        }
    }

    private intrinsicImpls = new Map<INT.Intrinsic, (...n: number[]) => number>([
        [INT.i32_clz, this.module.i32.clz],
        [INT.i32_ctz, this.module.i32.ctz],
        [INT.i32_popcnt, this.module.i32.popcnt],
        [INT.i32_eqz, this.module.i32.eqz],
        [INT.i32_add, this.module.i32.add],
        [INT.i32_sub, this.module.i32.sub],
        [INT.i32_mul, this.module.i32.mul],
        [INT.i32_div_s, this.module.i32.div_s],
        [INT.i32_div_u, this.module.i32.div_u],
        [INT.i32_rem_s, this.module.i32.rem_s],
        [INT.i32_rem_u, this.module.i32.rem_u],
        [INT.i32_and, this.module.i32.and],
        [INT.i32_or, this.module.i32.or],
        [INT.i32_xor, this.module.i32.xor],
        [INT.i32_shl, this.module.i32.shl],
        [INT.i32_shr_s, this.module.i32.shr_s],
        [INT.i32_shr_u, this.module.i32.shr_u],
        [INT.i32_rotl, this.module.i32.rotl],
        [INT.i32_rotr, this.module.i32.rotr],
        [INT.i32_eq, this.module.i32.eq],
        [INT.i32_ne, this.module.i32.ne],
        [INT.i32_lt_s, this.module.i32.lt_s],
        [INT.i32_lt_u, this.module.i32.lt_u],
        [INT.i32_le_s, this.module.i32.le_s],
        [INT.i32_le_u, this.module.i32.le_u],
        [INT.i32_gt_s, this.module.i32.gt_s],
        [INT.i32_gt_u, this.module.i32.gt_u],
        [INT.i32_ge_s, this.module.i32.ge_s],
        [INT.i32_ge_u, this.module.i32.ge_u],
        [INT.i32_trunc_f32_s, this.module.i32.trunc_s.f32],
        [INT.i32_trunc_f64_s, this.module.i32.trunc_s.f64],
        [INT.i32_trunc_f32_u, this.module.i32.trunc_u.f32],
        [INT.i32_trunc_f64_u, this.module.i32.trunc_u.f64],
        [INT.i32_reinterpret_f32, this.module.i32.reinterpret],
        [INT.i32_wrap_i64, this.module.i32.wrap],
        [INT.i32_extend8_s, this.module.i32.extend8_s],
        [INT.i32_extend16_s, this.module.i32.extend16_s],

        [INT.i64_clz, this.module.i64.clz],
        [INT.i64_ctz, this.module.i64.ctz],
        [INT.i64_popcnt, this.module.i64.popcnt],
        [INT.i64_eqz, this.module.i64.eqz],
        [INT.i64_add, this.module.i64.add],
        [INT.i64_sub, this.module.i64.sub],
        [INT.i64_mul, this.module.i64.mul],
        [INT.i64_div_s, this.module.i64.div_s],
        [INT.i64_div_u, this.module.i64.div_u],
        [INT.i64_rem_s, this.module.i64.rem_s],
        [INT.i64_rem_u, this.module.i64.rem_u],
        [INT.i64_and, this.module.i64.and],
        [INT.i64_or, this.module.i64.or],
        [INT.i64_xor, this.module.i64.xor],
        [INT.i64_shl, this.module.i64.shl],
        [INT.i64_shr_s, this.module.i64.shr_s],
        [INT.i64_shr_u, this.module.i64.shr_u],
        [INT.i64_rotl, this.module.i64.rotl],
        [INT.i64_rotr, this.module.i64.rotr],
        [INT.i64_eq, this.module.i64.eq],
        [INT.i64_ne, this.module.i64.ne],
        [INT.i64_lt_s, this.module.i64.lt_s],
        [INT.i64_lt_u, this.module.i64.lt_u],
        [INT.i64_le_s, this.module.i64.le_s],
        [INT.i64_le_u, this.module.i64.le_u],
        [INT.i64_gt_s, this.module.i64.gt_s],
        [INT.i64_gt_u, this.module.i64.gt_u],
        [INT.i64_ge_s, this.module.i64.ge_s],
        [INT.i64_ge_u, this.module.i64.ge_u],
        [INT.i64_trunc_f32_s, this.module.i64.trunc_s.f32],
        [INT.i64_trunc_f64_s, this.module.i64.trunc_s.f64],
        [INT.i64_trunc_f32_u, this.module.i64.trunc_u.f32],
        [INT.i64_trunc_f64_u, this.module.i64.trunc_u.f64],
        [INT.i64_reinterpret_f64, this.module.i64.reinterpret],
        [INT.i64_extend_i32_s, this.module.i64.extend_s],
        [INT.i64_extend_i32_u, this.module.i64.extend_u],
        [INT.i64_extend8_s, this.module.i64.extend8_s],
        [INT.i64_extend16_s, this.module.i64.extend16_s],

        [INT.f32_neg, this.module.f32.neg],
        [INT.f32_abs, this.module.f32.abs],
        [INT.f32_ceil, this.module.f32.ceil],
        [INT.f32_floor, this.module.f32.floor],
        [INT.f32_trunc, this.module.f32.trunc],
        [INT.f32_nearest, this.module.f32.nearest],
        [INT.f32_sqrt, this.module.f32.sqrt],
        [INT.f32_add, this.module.f32.add],
        [INT.f32_sub, this.module.f32.sub],
        [INT.f32_mul, this.module.f32.mul],
        [INT.f32_div, this.module.f32.div],
        [INT.f32_copysign, this.module.f32.copysign],
        [INT.f32_min, this.module.f32.min],
        [INT.f32_max, this.module.f32.max],
        [INT.f32_eq, this.module.f32.eq],
        [INT.f32_ne, this.module.f32.ne],
        [INT.f32_lt, this.module.f32.lt],
        [INT.f32_le, this.module.f32.le],
        [INT.f32_gt, this.module.f32.gt],
        [INT.f32_ge, this.module.f32.ge],
        [INT.f32_convert_i32_s, this.module.f32.convert_s.i32],
        [INT.f32_convert_i64_s, this.module.f32.convert_s.i64],
        [INT.f32_convert_i32_u, this.module.f32.convert_u.i32],
        [INT.f32_convert_i64_u, this.module.f32.convert_u.i64],
        [INT.f32_reinterpret_i32, this.module.f32.reinterpret],
        [INT.f32_demote_f64, this.module.f32.demote],

        [INT.f64_neg, this.module.f64.neg],
        [INT.f64_abs, this.module.f64.abs],
        [INT.f64_ceil, this.module.f64.ceil],
        [INT.f64_floor, this.module.f64.floor],
        [INT.f64_trunc, this.module.f64.trunc],
        [INT.f64_nearest, this.module.f64.nearest],
        [INT.f64_sqrt, this.module.f64.sqrt],
        [INT.f64_add, this.module.f64.add],
        [INT.f64_sub, this.module.f64.sub],
        [INT.f64_mul, this.module.f64.mul],
        [INT.f64_div, this.module.f64.div],
        [INT.f64_copysign, this.module.f64.copysign],
        [INT.f64_min, this.module.f64.min],
        [INT.f64_max, this.module.f64.max],
        [INT.f64_eq, this.module.f64.eq],
        [INT.f64_ne, this.module.f64.ne],
        [INT.f64_lt, this.module.f64.lt],
        [INT.f64_le, this.module.f64.le],
        [INT.f64_gt, this.module.f64.gt],
        [INT.f64_ge, this.module.f64.ge],
        [INT.f64_convert_i32_s, this.module.f64.convert_s.i32],
        [INT.f64_convert_i64_s, this.module.f64.convert_s.i64],
        [INT.f64_convert_i32_u, this.module.f64.convert_u.i32],
        [INT.f64_convert_i64_u, this.module.f64.convert_u.i64],
        [INT.f64_reinterpret_i64, this.module.f64.reinterpret],
        [INT.f64_promote_f32, this.module.f64.promote]
    ]);
}
