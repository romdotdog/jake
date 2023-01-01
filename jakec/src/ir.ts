import * as AST from "./ast";
import { Span } from "./lexer";

export class Program {
    public contents: Fn[] = [];
}

export type Fn = HostImport | SingleFunction | FunctionSum;

export class HostImport {
    constructor(
        public internalName: string,
        public moduleName: string,
        public functionName: string,
        public ty: Exponential | Never
    ) {}
}

export class SingleFunction {
    constructor(
        public internalName: string,
        public functionName: string,
        public ty: Exponential,
        public params: Local[],
        public locals: Local[],
        public body: Statement[]
    ) {}

    public addLocal(name: string, mut: boolean, ty: Type) {
        const local = new Local(this.locals.length, name, mut, ty);
        this.locals.push(local);
        return local;
    }
}

export class FunctionSum {
    constructor(
        public functionName: string,
        public impls: SingleFunction[],
        public ty: ExponentialSum
    ) {}
}

export class Local {
    public internalName: string;
    constructor(public idx: number, public name: string, public mut: boolean, public ty: Type) {
        this.internalName = labelize(`${name}_${ty.print()}`);
    }
}

export type Statement = LocalSet | Return | Drop;

export class LocalSet {
    constructor(public local: Local, public expr: Expression) {}
}

export class Return {
    constructor(public expr: Expression) {}
}

export class Drop {
    constructor(public expr: Expression) {}
}

export type Expression = Unreachable | Fn | Local | Call | Integer | NumberExpr;
export type VirtualExpression = Expression | VirtualInteger;

export class Unreachable {
    public ty: Never;
    constructor(span: Span) {
        this.ty = new Never(span);
    }

    public static drop(span: Span): Drop {
        return new Drop(new Unreachable(span));
    }
}

export class Call {
    constructor(
        public span: Span,
        public fn: Expression,
        public args: Expression[],
        public ty: Type
    ) {}
}

export class Integer {
    constructor(public span: Span, public value: bigint, public ty: StackTy | HeapTy) {}
}
export class VirtualInteger {
    constructor(public span: Span, public value: bigint, public ty: NumberTy) {}

    public static fromValue(span: Span, value: bigint): VirtualInteger | null {
        let ty: NumberTy;
        if (value >= 0n) {
            if (value < 2n ** 7n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U7);
            } else if (value < 2n ** 8n) {
                ty = new HeapTy(span, AST.HeapTyEnum.U8);
            } else if (value < 2n ** 15n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U15);
            } else if (value < 2n ** 16n) {
                ty = new HeapTy(span, AST.HeapTyEnum.U16);
            } else if (value < 2n ** 24n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U24);
            } else if (value < 2n ** 31n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U31);
            } else if (value < 2n ** 32n) {
                ty = new StackTy(span, AST.StackTyEnum.U32);
            } else if (value < 2n ** 53n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U53);
            } else if (value < 2n ** 63n) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.U63);
            } else if (value < 2n ** 64n) {
                ty = new StackTy(span, AST.StackTyEnum.U64);
            } else {
                return null;
            }
        } else {
            if (value >= -(2n ** 7n)) {
                ty = new HeapTy(span, AST.HeapTyEnum.I8);
            } else if (value >= -(2n ** 15n)) {
                ty = new HeapTy(span, AST.HeapTyEnum.I16);
            } else if (value >= -(2n ** 24n)) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.I25);
            } else if (value >= -(2n ** 31n)) {
                ty = new StackTy(span, AST.StackTyEnum.I32);
            } else if (value >= -(2n ** 53n)) {
                ty = new VirtualIntegerTy(VirtualIntegerTyEnum.I54);
            } else if (value >= -(2n ** 63n)) {
                ty = new StackTy(span, AST.StackTyEnum.I64);
            } else {
                return null;
            }
        }
        return new VirtualInteger(span, value, ty);
    }
}

export class NumberExpr {
    constructor(public span: Span, public value: number, public ty: StackTy) {}
}

export type Type = ExponentialSum | Exponential | Product | StackTy | HeapTy | Never;
export type VirtualType = Type | VirtualIntegerTy | VirtualExponential;

export class VirtualExponential {
    constructor(
        public span: Span,
        public pure: boolean,
        public params: VirtualType[],
        public ret: VirtualType
    ) {}

    public equals(other: VirtualType): boolean {
        if (other instanceof VirtualExponential) {
            return (
                this.pure == other.pure &&
                this.params.length == other.params.length &&
                this.ret.equals(other.ret) &&
                this.params.every((v, i) => v.equals(other.params[i]))
            );
        }
        return false;
    }

    public assignableTo(other: VirtualType): boolean {
        if (other instanceof VirtualExponential) {
            return (
                this.pure == other.pure &&
                this.params.length == other.params.length &&
                this.ret.assignableTo(other.ret) &&
                this.params.every((v, i) => v.assignableTo(other.params[i]))
            );
        }
        return false;
    }

    public print(): string {
        function formatType(ty: VirtualType): string {
            if (ty instanceof VirtualExponential || ty instanceof ExponentialSum) {
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

export class Exponential extends VirtualExponential {
    constructor(public span: Span, public pure: boolean, public params: Type[], public ret: Type) {
        super(span, pure, params, ret);
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

export class Product {
    constructor(public span: Span, public fields: Type[]) {}

    equals(other: VirtualType): boolean {
        if (other instanceof Product) {
            return (
                this.fields.length == other.fields.length &&
                this.fields.every((v, i) => v.equals(other.fields[i]))
            );
        }
        return false;
    }

    public assignableTo(other: VirtualType): boolean {
        if (other instanceof Product) {
            return (
                this.fields.length == other.fields.length &&
                this.fields.every((v, i) => v.assignableTo(other.fields[i]))
            );
        }
        return false;
    }

    public print(): string {
        return "[" + this.fields.map(v => v.print()).join(", ") + "]";
    }
}

export class StackTy {
    constructor(public span: Span, public value: AST.StackTyEnum) {}

    public equals(other: VirtualType) {
        if (other instanceof StackTy) {
            return this.value == other.value;
        }
        return false;
    }

    public assignableTo(other: VirtualType): boolean {
        return this.equals(other);
    }

    public print(): string {
        switch (this.value) {
            case AST.StackTyEnum.I32:
                return "i32";
            case AST.StackTyEnum.U32:
                return "u32";
            case AST.StackTyEnum.F32:
                return "f32";
            case AST.StackTyEnum.I64:
                return "i64";
            case AST.StackTyEnum.U64:
                return "u64";
            case AST.StackTyEnum.F64:
                return "f64";
        }
    }
}

export class HeapTy {
    constructor(public span: Span, public value: AST.HeapTyEnum) {}

    public equals(other: VirtualType) {
        if (other instanceof HeapTy) {
            return this.value == other.value;
        }
        return false;
    }

    public assignableTo(other: VirtualType): boolean {
        return this.equals(other);
    }

    public print(): string {
        switch (this.value) {
            case AST.HeapTyEnum.I8:
                return "i8";
            case AST.HeapTyEnum.U8:
                return "u8";
            case AST.HeapTyEnum.I16:
                return "i16";
            case AST.HeapTyEnum.U16:
                return "u16";
        }
    }
}

type NumberTy = VirtualIntegerTy | StackTy | HeapTy;
const idMask = (1 << 19) - 1;
export class VirtualIntegerTy {
    constructor(public value: VirtualIntegerTyEnum) {}

    public equals(other: VirtualType): boolean {
        if (other instanceof VirtualIntegerTy) {
            return this.value == other.value;
        }
        return false;
    }

    public assignableTo(other: VirtualType): other is NumberTy {
        if (
            other instanceof VirtualIntegerTy ||
            other instanceof StackTy ||
            other instanceof HeapTy
        ) {
            const otherMask = other.value >>> 18;
            const thisId = this.value & idMask; // javascript does not offer ctz
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
    U7  = 0b100000000000000000000000000000000001,
    U15 = 0b101100000000000000000000000000001000,
    U24 = 0b101101100000000000000000000001000000,
    I25 = 0b111111110000000000000000000010000000,
    U31 = 0b101101100100000000000000001000000000,
    U53 = 0b101101100101100000000001000000000000,
    I54 = 0b111111110111010000000010000000000000,
    U63 = 0b101101100101000100001000000000000000
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
    const buffer = ["$"];
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
                    buffer.push(x.charAt(code));
            }
    }
    return buffer.join("");
}
