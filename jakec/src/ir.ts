import * as AST from "./ast.js";
import * as INT from "./intrinsics.js";
import { Span } from "./lexer.js";

export class Program {
    public globals: Global[] = [];
    public contents: Fn[] = [];
    public _start: FunctionImpl | null = null;
    public exportMap: Set<string> = new Set();

    // TODO: maybe add a Span.None or something?
    public addStartStatement(stmt: Statement) {
        if (this._start === null) {
            this._start = new FunctionImpl(
                "_start",
                "_start",
                true,
                new Exponential<WASMResultType>(Span.None, false, [Product.void(Span.None)], Product.void(Span.None)),
                [],
                [],
                [stmt]
            );
            return;
        }
        this._start.body.push(stmt);
    }
}

export type Fn = HostImport | FunctionImpl;

export class HostImport {
    constructor(
        public span: Span,
        public internalName: string,
        public moduleName: string,
        public importFunctionName: string,
        public name: string,
        public ty: Exponential<WASMStackType, WASMResultType>
    ) {}
}

export class FunctionImpl {
    constructor(
        public internalName: string,
        public name: string,
        public host: boolean,
        public ty: Exponential<WASMResultType>,
        public params: Local[],
        public locals: Local[],
        public body: Statement[]
    ) {}

    public addLocal(name: string, mut: boolean, ty: WASMStackType) {
        const local = new Local(this.locals.length, name, mut, ty);
        this.locals.push(local);
        return local;
    }
}

export class FunctionSum {
    constructor(public functionName: string, public impls: Fn[], public ty: ExponentialSum) {}
}

export type WASMStackType = StackTy | Never;
export type WASMResultType = WASMStackType | Void;

export class Global {
    constructor(
        public internalName: string,
        public name: string,
        public host: boolean,
        public mut: boolean,
        public ty: WASMStackType
    ) {}
}

export class Local {
    public internalName: string;
    constructor(public idx: number, public name: string, public mut: boolean, public ty: WASMStackType) {
        this.internalName = labelize(`${name}_${ty.print()}`);
    }
}

export type Statement = LocalSet | GlobalSet | Return | Drop | If;

export class LocalSet {
    constructor(public local: Local, public expr: Expression) {}
}

export class GlobalSet {
    constructor(public global: Global, public expr: Expression) {}
}

export class Return {
    constructor(public expr: Expression) {}
}

export class Drop {
    constructor(public expr: Expression) {}
}

export class If {
    constructor(public cond: Expression, public body: Statement[], public else_: Statement[]) {}
}

export type Expression = Unreachable | LocalRef | GlobalRef | Call | IntrinsicCall | Integer | Float | ProductCtr;
export type VirtualExpression = Expression | VirtualInteger | Fn;

export class Unreachable {
    public ty: Never;
    constructor(span: Span) {
        this.ty = new Never(span);
    }

    public static drop(span: Span): Drop {
        return new Drop(new Unreachable(span));
    }
}

export class LocalRef {
    constructor(public span: Span, public local: Local, public ty: WASMStackType) {}
}

export class GlobalRef {
    constructor(public span: Span, public global: Global, public ty: WASMStackType) {}
}

export class Call {
    constructor(public span: Span, public fn: Fn, public args: Expression[], public ty: Type) {}
}

export class IntrinsicCall {
    constructor(public span: Span, public intrinsic: INT.Intrinsic, public args: Expression[], public ty: Type) {}
}

export class ProductCtr {
    constructor(public span: Span, public values: Expression[], public ty: Product) {}

    public static void(exprSpan: Span, tySpan: Span) {
        return new ProductCtr(exprSpan, [], Product.void(tySpan));
    }
}

// prettier-ignore
export enum HeapTyEnum {
    I8  = 0b000000000000000011,
    U8  = 0b000000000000000101,
    I16 = 0b000000000000011111,
    U16 = 0b000000000000101101
}

export enum StackTyEnum {
    F32 = 0b000000000111111111,
    I32 = 0b000000011011111111,
    U32 = 0b000000101001101101,
    F64 = 0b000111111111111111,
    I64 = 0b011011111011111111,
    U64 = 0b101001101001101101
}

type IntegerStackTy = StackTy & {
    value: StackTyEnum.I32 | StackTyEnum.U32 | StackTyEnum.I64 | StackTyEnum.U64;
};

export type IntegerTy = IntegerStackTy | HeapTy;

export function isIntegerTy(ty: unknown): ty is IntegerTy {
    return (
        ty instanceof HeapTy || (ty instanceof StackTy && ty.value !== StackTyEnum.F32 && ty.value !== StackTyEnum.F64)
    );
}

export class Integer {
    constructor(public span: Span, public value: bigint, public ty: IntegerTy) {}
}

export class VirtualInteger {
    constructor(public span: Span, public value: bigint, public ty: NumberTy) {}

    public static fromValue(span: Span, value: bigint): VirtualInteger | null {
        let ty: NumberTy;
        if (value >= 0n) {
            if (value < 2n ** 7n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U7);
            } else if (value < 2n ** 8n) {
                ty = new HeapTy(span, HeapTyEnum.U8);
            } else if (value < 2n ** 15n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U15);
            } else if (value < 2n ** 16n) {
                ty = new HeapTy(span, HeapTyEnum.U16);
            } else if (value < 2n ** 24n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U24);
            } else if (value < 2n ** 31n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U31);
            } else if (value < 2n ** 32n) {
                ty = new StackTy(span, StackTyEnum.U32);
            } else if (value < 2n ** 53n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U53);
            } else if (value < 2n ** 63n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U63);
            } else if (value < 2n ** 64n) {
                ty = new StackTy(span, StackTyEnum.U64);
            } else {
                return null;
            }
        } else {
            if (value >= -(2n ** 7n)) {
                ty = new HeapTy(span, HeapTyEnum.I8);
            } else if (value >= -(2n ** 15n)) {
                ty = new HeapTy(span, HeapTyEnum.I16);
            } else if (value >= -(2n ** 24n)) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.I25);
            } else if (value >= -(2n ** 31n)) {
                ty = new StackTy(span, StackTyEnum.I32);
            } else if (value >= -(2n ** 53n)) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.I54);
            } else if (value >= -(2n ** 63n)) {
                ty = new StackTy(span, StackTyEnum.I64);
            } else {
                return null;
            }
        }
        return new VirtualInteger(span, value, ty);
    }
}

export type FloatTy = StackTy & { value: StackTyEnum.F32 | StackTyEnum.F64 };

export function isFloatTy(ty: unknown): ty is FloatTy {
    return ty instanceof StackTy && (ty.value === StackTyEnum.F32 || ty.value === StackTyEnum.F64);
}

export class Float {
    constructor(public span: Span, public value: number, public ty: FloatTy) {}
}

export interface TypeInterface {
    equals(other: TypeInterface): boolean;
    assignableTo(other: TypeInterface): boolean;
    print(): string;
}

export type Type = ExponentialSum | Exponential | Product | StackTy | HeapTy | Never;
export type VirtualType = Type | VirtualIntegerTy | VirtualExponential;

export type VirtualExponential = Exponential<VirtualType>;
export class Exponential<Param extends TypeInterface = Type, Result extends TypeInterface = Param> {
    constructor(public span: Span, public pure: boolean, public params: Param[], public ret: Result) {}

    public equals(other: VirtualType): boolean {
        if (other instanceof Exponential) {
            return (
                this.pure == other.pure &&
                this.params.length == other.params.length &&
                this.ret.equals(other.ret) &&
                this.params.every((v, i) => v.equals(other.params[i]))
            );
        }
        return false;
    }

    public assignableTo(other: TypeInterface): boolean {
        if (Product.isVoid(other)) {
            return true;
        }
        if (other instanceof Exponential) {
            return (
                (this.pure || !other.pure) &&
                this.params.length == other.params.length &&
                other.ret.assignableTo(this.ret) && // notice
                this.params.every((v, i) => v.assignableTo(other.params[i]))
            );
        }
        return false;
    }

    public print(): string {
        function formatType(ty: TypeInterface): string {
            if (ty instanceof Exponential || ty instanceof ExponentialSum) {
                return `(${ty.print()})`;
            }
            return ty.print();
        }

        const buffer = this.params.map(v => formatType(v));
        buffer.push(formatType(this.ret));

        if (this.pure) {
            return `pure ${buffer.join(" -> ")}`;
        } else {
            return buffer.join(" -> ");
        }
    }
}

export class ExponentialSum {
    constructor(public span: Span, public exponentials: Exponential[]) {}

    public equals(other: VirtualType): boolean {
        if (other instanceof ExponentialSum) {
            return (
                this.exponentials.length == other.exponentials.length &&
                this.exponentials.every((v, i) => v.equals(other.exponentials[i]))
            );
        }
        return false;
    }

    public assignableTo(other: VirtualType): boolean {
        if (Product.isVoid(other)) {
            return true;
        }
        if (other instanceof ExponentialSum) {
            return (
                this.exponentials.length == other.exponentials.length &&
                this.exponentials.every((v, i) => v.assignableTo(other.exponentials[i]))
            );
        }
        return false;
    }

    public print(): string {
        return this.exponentials.map(v => v.print()).join(" | ");
    }
}

export type Void = Product & { fields: [] };
export class Product {
    constructor(public span: Span, public fields: Type[]) {}

    public static void(span: Span): Void {
        return <Void>new Product(span, []);
    }

    public static isVoid(ty: TypeInterface): ty is Void {
        return ty instanceof Product && ty.isVoid();
    }

    public isVoid(): this is Void {
        return this.fields.length === 0;
    }

    public equals(other: VirtualType): boolean {
        if (other instanceof Product) {
            return this.fields.length == other.fields.length && this.fields.every((v, i) => v.equals(other.fields[i]));
        }
        return false;
    }

    public assignableTo(other: VirtualType): boolean {
        if (other instanceof Product) {
            return (
                other.fields.length === 0 ||
                (this.fields.length == other.fields.length &&
                    this.fields.every((v, i) => v.assignableTo(other.fields[i])))
            );
        }
        return false;
    }

    public print(): string {
        return "[" + this.fields.map(v => v.print()).join(", ") + "]";
    }
}

export class StackTy {
    constructor(public span: Span, public value: StackTyEnum) {}

    public equals(other: VirtualType) {
        if (other instanceof StackTy) {
            return this.value == other.value;
        }
        return false;
    }

    public assignableTo(other: VirtualType): boolean {
        if (Product.isVoid(other)) {
            return true;
        }
        return this.equals(other);
    }

    public print(): string {
        switch (this.value) {
            case StackTyEnum.I32:
                return "i32";
            case StackTyEnum.U32:
                return "u32";
            case StackTyEnum.F32:
                return "f32";
            case StackTyEnum.I64:
                return "i64";
            case StackTyEnum.U64:
                return "u64";
            case StackTyEnum.F64:
                return "f64";
        }
    }
}

export class HeapTy {
    constructor(public span: Span, public value: HeapTyEnum) {}

    public equals(other: VirtualType) {
        if (other instanceof HeapTy) {
            return this.value == other.value;
        }
        return false;
    }

    public assignableTo(other: VirtualType): boolean {
        if (Product.isVoid(other)) {
            return true;
        }
        return this.equals(other);
    }

    public print(): string {
        switch (this.value) {
            case HeapTyEnum.I8:
                return "i8";
            case HeapTyEnum.U8:
                return "u8";
            case HeapTyEnum.I16:
                return "i16";
            case HeapTyEnum.U16:
                return "u16";
        }
    }
}

type NumberTy = VirtualIntegerTy | StackTy | HeapTy;
export class VirtualIntegerTy {
    constructor(public value: VirtualIntegerTyEnum) {}

    public equals(other: VirtualType): boolean {
        if (other instanceof VirtualIntegerTy) {
            return this.value == other.value;
        }
        return false;
    }

    // putting void in place of product leads to soundness issues..?
    public assignableTo(other: VirtualType): other is NumberTy | Product {
        if (Product.isVoid(other)) {
            return true;
        }
        if (other instanceof VirtualIntegerTy || other instanceof StackTy || other instanceof HeapTy) {
            const otherMask = other.value;
            const thisId = 1 << (31 - Math.clz32(this.value));
            return (otherMask & thisId) !== 0;
        }
        return false;
    }

    public print(): string {
        switch (this.value) {
            case VirtualIntegerTyEnum.U7:
                return "u7";
            case VirtualIntegerTyEnum.U15:
                return "u15";
            case VirtualIntegerTyEnum.U24:
                return "u24";
            case VirtualIntegerTyEnum.I25:
                return "i25";
            case VirtualIntegerTyEnum.U31:
                return "u31";
            case VirtualIntegerTyEnum.U53:
                return "u53";
            case VirtualIntegerTyEnum.I54:
                return "i54";
            case VirtualIntegerTyEnum.U63:
                return "u63";
        }
    }
}

export enum VirtualIntegerTyEnum {
    // prettier-ignore
    U7 = 0b000000000000000001,
    U15 = 0b000000000000001101,
    U24 = 0b000000000001101101,
    I25 = 0b000000000011111111,
    U31 = 0b000000001001101101,
    U53 = 0b000001101001101101,
    I54 = 0b000011111011111111,
    U63 = 0b001001101001101101
}
export class Never {
    constructor(public span: Span) {}

    public equals(other: VirtualType) {
        if (other instanceof Never) {
            return true;
        }
        return false;
    }

    public assignableTo(): boolean {
        return true;
    }

    public print(): string {
        return "never";
    }
}

export type Pattern = TypedPattern;

export class UntypedPattern {
    constructor(public span: Span, public mut: boolean, public ident: AST.Ident) {}
}

export class TypedPattern {
    constructor(public span: Span, public untyped: UntypedPattern, public ty: Type) {}
}

// this function will surjectively map arbitrary strings to labels
// only pathological inputs will yield collisions
export function labelize(x: string): string {
    const buffer = [];
    for (let i = 0; i < x.length; i++) {
        const code = x.charCodeAt(i);
        if (code === undefined) {
            throw new Error(":(");
        }
        if (code < 32 || code > 126) {
            const hex = code.toString(16);
            buffer.push(`\\u${"0".repeat(4 - hex.length)}${hex}`);
        } else
            switch (code) {
                case 32:
                    buffer.push("_");
                    break;
                case 34:
                    buffer.push("''");
                    break;
                case 40:
                case 41:
                case 91:
                case 93:
                    buffer.push("|");
                    break;
                case 44:
                    buffer.push(".");
                    break;
                case 59:
                case 123:
                case 125:
                    break;
                default:
                    buffer.push(String.fromCharCode(code));
            }
    }
    return buffer.join("");
}
