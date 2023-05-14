import * as IR from "./ir.js";
import { Span } from "./lexer.js";

export class Namespace {
    public contents: Map<string, Namespace | Intrinsic>;
    constructor(obj: Record<string, Namespace | Intrinsic>) {
        this.contents = new Map(Object.entries(obj));
    }
}

export class Intrinsic {
    constructor(public sig: IR.Exponential<IR.WASMResultType>) {}
}

const i32 = new IR.StackTy(Span.None, IR.StackTyEnum.I32);
const u32 = new IR.StackTy(Span.None, IR.StackTyEnum.U32);

const i32_unop = new IR.Exponential(Span.None, true, [i32], i32);
const i32_binop = new IR.Exponential(Span.None, true, [i32, i32], i32);
const u32_binop = new IR.Exponential(Span.None, true, [u32, u32], u32);
const i32_bincomp = new IR.Exponential(Span.None, true, [i32, i32], i32);
const u32_bincomp = new IR.Exponential(Span.None, true, [u32, u32], i32);

export const i32_clz = new Intrinsic(i32_unop);
export const i32_ctz = new Intrinsic(i32_unop);
export const i32_popcnt = new Intrinsic(i32_unop);
export const i32_eqz = new Intrinsic(i32_unop);
export const i32_add = new Intrinsic(i32_binop);
export const i32_sub = new Intrinsic(i32_binop);
export const i32_mul = new Intrinsic(i32_binop);
export const i32_div_s = new Intrinsic(i32_binop);
export const i32_div_u = new Intrinsic(u32_binop);
export const i32_rem_s = new Intrinsic(i32_binop);
export const i32_rem_u = new Intrinsic(u32_binop);
export const i32_and = new Intrinsic(i32_binop);
export const i32_or = new Intrinsic(i32_binop);
export const i32_xor = new Intrinsic(i32_binop);
export const i32_shl = new Intrinsic(i32_binop);
export const i32_shr_s = new Intrinsic(i32_binop);
export const i32_shr_u = new Intrinsic(u32_binop);
export const i32_rotl = new Intrinsic(i32_binop);
export const i32_rotr = new Intrinsic(i32_binop);
export const i32_eq = new Intrinsic(i32_bincomp);
export const i32_ne = new Intrinsic(i32_bincomp);
export const i32_lt_s = new Intrinsic(i32_bincomp);
export const i32_lt_u = new Intrinsic(u32_bincomp);
export const i32_le_s = new Intrinsic(i32_bincomp);
export const i32_le_u = new Intrinsic(u32_bincomp);
export const i32_gt_s = new Intrinsic(i32_bincomp);
export const i32_gt_u = new Intrinsic(u32_bincomp);
export const i32_ge_s = new Intrinsic(i32_bincomp);
export const i32_ge_u = new Intrinsic(u32_bincomp);

export const i32_extend8_s = new Intrinsic(i32_unop);
export const i32_extend16_s = new Intrinsic(i32_unop);

const i64 = new IR.StackTy(Span.None, IR.StackTyEnum.I64);
const u64 = new IR.StackTy(Span.None, IR.StackTyEnum.U64);

const i64_unop = new IR.Exponential(Span.None, true, [i64], i64);
const i64_binop = new IR.Exponential(Span.None, true, [i64, i64], i64);
const u64_binop = new IR.Exponential(Span.None, true, [u64, u64], u64);
const i64_bincomp = new IR.Exponential(Span.None, true, [i64, i64], i32);
const u64_bincomp = new IR.Exponential(Span.None, true, [u64, u64], i32);

export const i64_clz = new Intrinsic(i64_unop);
export const i64_ctz = new Intrinsic(i64_unop);
export const i64_popcnt = new Intrinsic(i64_unop);
export const i64_eqz = new Intrinsic(i64_unop);
export const i64_add = new Intrinsic(i64_binop);
export const i64_sub = new Intrinsic(i64_binop);
export const i64_mul = new Intrinsic(i64_binop);
export const i64_div_s = new Intrinsic(i64_binop);
export const i64_div_u = new Intrinsic(u64_binop);
export const i64_rem_s = new Intrinsic(i64_binop);
export const i64_rem_u = new Intrinsic(u64_binop);
export const i64_and = new Intrinsic(i64_binop);
export const i64_or = new Intrinsic(i64_binop);
export const i64_xor = new Intrinsic(i64_binop);
export const i64_shl = new Intrinsic(i64_binop);
export const i64_shr_s = new Intrinsic(i64_binop);
export const i64_shr_u = new Intrinsic(u64_binop);
export const i64_rotl = new Intrinsic(i64_binop);
export const i64_rotr = new Intrinsic(i64_binop);
export const i64_eq = new Intrinsic(i64_bincomp);
export const i64_ne = new Intrinsic(i64_bincomp);
export const i64_lt_s = new Intrinsic(i64_bincomp);
export const i64_lt_u = new Intrinsic(u64_bincomp);
export const i64_le_s = new Intrinsic(i64_bincomp);
export const i64_le_u = new Intrinsic(u64_bincomp);
export const i64_gt_s = new Intrinsic(i64_bincomp);
export const i64_gt_u = new Intrinsic(u64_bincomp);
export const i64_ge_s = new Intrinsic(i64_bincomp);
export const i64_ge_u = new Intrinsic(u64_bincomp);

export const i32_wrap_i64 = new Intrinsic(new IR.Exponential(Span.None, true, [i64], i32));
export const i64_extend_i32_s = new Intrinsic(new IR.Exponential(Span.None, true, [i32], i64));
export const i64_extend_i32_u = new Intrinsic(new IR.Exponential(Span.None, true, [u32], u64));

export const i64_extend8_s = new Intrinsic(i64_binop);
export const i64_extend16_s = new Intrinsic(i64_binop);
export const i64_extend32_s = new Intrinsic(i64_binop);

const f32 = new IR.StackTy(Span.None, IR.StackTyEnum.F32);

const f32_unop = new IR.Exponential(Span.None, true, [f32], f32);
const f32_binop = new IR.Exponential(Span.None, true, [f32, f32], f32);
const f32_bincomp = new IR.Exponential(Span.None, true, [f32, f32], i32);

export const f32_neg = new Intrinsic(f32_unop);
export const f32_abs = new Intrinsic(f32_unop);
export const f32_ceil = new Intrinsic(f32_unop);
export const f32_floor = new Intrinsic(f32_unop);
export const f32_trunc = new Intrinsic(f32_unop);
export const f32_nearest = new Intrinsic(f32_unop);
export const f32_sqrt = new Intrinsic(f32_unop);
export const f32_add = new Intrinsic(f32_binop);
export const f32_sub = new Intrinsic(f32_binop);
export const f32_mul = new Intrinsic(f32_binop);
export const f32_div = new Intrinsic(f32_binop);
export const f32_copysign = new Intrinsic(f32_binop);
export const f32_min = new Intrinsic(f32_binop);
export const f32_max = new Intrinsic(f32_binop);
export const f32_eq = new Intrinsic(f32_bincomp);
export const f32_ne = new Intrinsic(f32_bincomp);
export const f32_lt = new Intrinsic(f32_bincomp);
export const f32_le = new Intrinsic(f32_bincomp);
export const f32_gt = new Intrinsic(f32_bincomp);
export const f32_ge = new Intrinsic(f32_bincomp);

export const i32_trunc_f32_s = new Intrinsic(new IR.Exponential(Span.None, true, [f32], i32));
export const i32_trunc_f32_u = new Intrinsic(new IR.Exponential(Span.None, true, [f32], u32));
export const i64_trunc_f32_s = new Intrinsic(new IR.Exponential(Span.None, true, [f32], i64));
export const i64_trunc_f32_u = new Intrinsic(new IR.Exponential(Span.None, true, [f32], u64));

export const f32_convert_i32_s = new Intrinsic(new IR.Exponential(Span.None, true, [i32], f32));
export const f32_convert_i32_u = new Intrinsic(new IR.Exponential(Span.None, true, [u32], f32));
export const f32_convert_i64_s = new Intrinsic(new IR.Exponential(Span.None, true, [i64], f32));
export const f32_convert_i64_u = new Intrinsic(new IR.Exponential(Span.None, true, [u64], f32));

export const i32_reinterpret_f32 = new Intrinsic(new IR.Exponential(Span.None, true, [f32], i32));
export const f32_reinterpret_i32 = new Intrinsic(new IR.Exponential(Span.None, true, [i32], f32));

const f64 = new IR.StackTy(Span.None, IR.StackTyEnum.F64);

const f64_unop = new IR.Exponential(Span.None, true, [f64], f64);
const f64_binop = new IR.Exponential(Span.None, true, [f64, f64], f64);
const f64_bincomp = new IR.Exponential(Span.None, true, [f64, f64], i32);

export const f64_neg = new Intrinsic(f64_unop);
export const f64_abs = new Intrinsic(f64_unop);
export const f64_ceil = new Intrinsic(f64_unop);
export const f64_floor = new Intrinsic(f64_unop);
export const f64_trunc = new Intrinsic(f64_unop);
export const f64_nearest = new Intrinsic(f64_unop);
export const f64_sqrt = new Intrinsic(f64_unop);
export const f64_add = new Intrinsic(f64_binop);
export const f64_sub = new Intrinsic(f64_binop);
export const f64_mul = new Intrinsic(f64_binop);
export const f64_div = new Intrinsic(f64_binop);
export const f64_copysign = new Intrinsic(f64_binop);
export const f64_min = new Intrinsic(f64_binop);
export const f64_max = new Intrinsic(f64_binop);
export const f64_eq = new Intrinsic(f64_bincomp);
export const f64_ne = new Intrinsic(f64_bincomp);
export const f64_lt = new Intrinsic(f64_bincomp);
export const f64_le = new Intrinsic(f64_bincomp);
export const f64_gt = new Intrinsic(f64_bincomp);
export const f64_ge = new Intrinsic(f64_bincomp);

export const i32_trunc_f64_s = new Intrinsic(new IR.Exponential(Span.None, true, [f64], i32));
export const i32_trunc_f64_u = new Intrinsic(new IR.Exponential(Span.None, true, [f64], u32));
export const i64_trunc_f64_s = new Intrinsic(new IR.Exponential(Span.None, true, [f64], i64));
export const i64_trunc_f64_u = new Intrinsic(new IR.Exponential(Span.None, true, [f64], u64));

export const f64_convert_i32_s = new Intrinsic(new IR.Exponential(Span.None, true, [i32], f64));
export const f64_convert_i32_u = new Intrinsic(new IR.Exponential(Span.None, true, [u32], f64));
export const f64_convert_i64_s = new Intrinsic(new IR.Exponential(Span.None, true, [i64], f64));
export const f64_convert_i64_u = new Intrinsic(new IR.Exponential(Span.None, true, [u64], f64));

export const f32_demote_f64 = new Intrinsic(new IR.Exponential(Span.None, true, [f32], f64));
export const f64_promote_f32 = new Intrinsic(new IR.Exponential(Span.None, true, [f64], f32));

export const i64_reinterpret_f64 = new Intrinsic(new IR.Exponential(Span.None, true, [f64], i64));
export const f64_reinterpret_i64 = new Intrinsic(new IR.Exponential(Span.None, true, [i64], f64));

export const root = new Namespace({
    i32: new Namespace({
        clz: i32_clz,
        ctz: i32_ctz,
        popcnt: i32_popcnt,
        eqz: i32_eqz,
        add: i32_add,
        sub: i32_sub,
        mul: i32_mul,
        div_s: i32_div_s,
        div_u: i32_div_u,
        rem_s: i32_rem_s,
        rem_u: i32_rem_u,
        and: i32_and,
        or: i32_or,
        xor: i32_xor,
        shl: i32_shl,
        shr_s: i32_shr_s,
        shr_u: i32_shr_u,
        rotl: i32_rotl,
        rotr: i32_rotr,
        eq: i32_eq,
        ne: i32_ne,
        lt_s: i32_lt_s,
        lt_u: i32_lt_u,
        le_s: i32_le_s,
        le_u: i32_le_u,
        gt_s: i32_gt_s,
        gt_u: i32_gt_u,
        ge_s: i32_ge_s,
        ge_u: i32_ge_u,
        trunc_s: new Namespace({
            f32: i32_trunc_f32_s,
            f64: i32_trunc_f64_s
        }),
        trunc_u: new Namespace({
            f32: i32_trunc_f32_u,
            f64: i32_trunc_f64_u
        }),
        reinterpret: i32_reinterpret_f32,
        wrap: i32_wrap_i64,
        extend8_s: i32_extend8_s,
        extend16_s: i32_extend16_s
    }),
    i64: new Namespace({
        clz: i64_clz,
        ctz: i64_ctz,
        popcnt: i64_popcnt,
        eqz: i64_eqz,
        add: i64_add,
        sub: i64_sub,
        mul: i64_mul,
        div_s: i64_div_s,
        div_u: i64_div_u,
        rem_s: i64_rem_s,
        rem_u: i64_rem_u,
        and: i64_and,
        or: i64_or,
        xor: i64_xor,
        shl: i64_shl,
        shr_s: i64_shr_s,
        shr_u: i64_shr_u,
        rotl: i64_rotl,
        rotr: i64_rotr,
        eq: i64_eq,
        ne: i64_ne,
        lt_s: i64_lt_s,
        lt_u: i64_lt_u,
        le_s: i64_le_s,
        le_u: i64_le_u,
        gt_s: i64_gt_s,
        gt_u: i64_gt_u,
        ge_s: i64_ge_s,
        ge_u: i64_ge_u,
        trunc_s: new Namespace({
            f32: i64_trunc_f32_s,
            f64: i64_trunc_f64_s
        }),
        trunc_u: new Namespace({
            f32: i64_trunc_f32_u,
            f64: i64_trunc_f64_u
        }),
        reinterpret: i64_reinterpret_f64,
        extend_s: i64_extend_i32_s,
        extend_u: i64_extend_i32_u,
        extend8_s: i64_extend8_s,
        extend16_s: i64_extend16_s,
        extend32_s: i64_extend32_s
    }),
    f32: new Namespace({
        neg: f32_neg,
        abs: f32_abs,
        ceil: f32_ceil,
        floor: f32_floor,
        trunc: f32_trunc,
        nearest: f32_nearest,
        sqrt: f32_sqrt,
        add: f32_add,
        sub: f32_sub,
        mul: f32_mul,
        div: f32_div,
        copysign: f32_copysign,
        min: f32_min,
        max: f32_max,
        eq: f32_eq,
        ne: f32_ne,
        lt: f32_lt,
        le: f32_le,
        gt: f32_gt,
        ge: f32_ge,
        convert_s: new Namespace({
            i32: f32_convert_i32_s,
            i64: f32_convert_i64_s
        }),
        convert_u: new Namespace({
            i32: f32_convert_i32_u,
            i64: f32_convert_i64_u
        }),
        reinterpret: f32_reinterpret_i32,
        demote: f32_demote_f64
    }),
    f64: new Namespace({
        neg: f64_neg,
        abs: f64_abs,
        ceil: f64_ceil,
        floor: f64_floor,
        trunc: f64_trunc,
        nearest: f64_nearest,
        sqrt: f64_sqrt,
        add: f64_add,
        sub: f64_sub,
        mul: f64_mul,
        div: f64_div,
        copysign: f64_copysign,
        min: f64_min,
        max: f64_max,
        eq: f64_eq,
        ne: f64_ne,
        lt: f64_lt,
        le: f64_le,
        gt: f64_gt,
        ge: f64_ge,
        convert_s: new Namespace({
            i32: f64_convert_i32_s,
            i64: f64_convert_i64_s
        }),
        convert_u: new Namespace({
            i32: f64_convert_i32_u,
            i64: f64_convert_i64_u
        }),
        reinterpret: f64_reinterpret_i64,
        promote: f64_promote_f32
    })
});
