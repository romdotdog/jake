import * as AST from "./ast";
import { Span } from "./lexer";

export type Type = Exponential | Product | StackTy | HeapTy | Never;

export class Exponential {
    constructor(public span: Span, public pure: boolean, public params: Type[], public ret: Type) {}

    equals(other: Type): boolean {
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
}

export class ExponentialSum {
    constructor(public span: Span, public exponentials: Exponential[]) {}

    equals(other: Type): boolean {
        if (other instanceof ExponentialSum) {
            return (
                this.exponentials.length == other.exponentials.length &&
                this.exponentials.every((v, i) => v.equals(other.exponentials[i]))
            );
        }
        return false;
    }
}

export class Product {
    constructor(public span: Span, public fields: Type[]) {}

    equals(other: Type): boolean {
        if (other instanceof Product) {
            return (
                this.fields.length == other.fields.length &&
                this.fields.every((v, i) => v.equals(other.fields[i]))
            );
        }
        return false;
    }
}

export class StackTy {
    constructor(public span: Span, public value: AST.StackTyEnum) {}

    equals(other: Type) {
        if (other instanceof StackTy) {
            return this.value == other.value;
        }
        return false;
    }
}

export class HeapTy {
    constructor(public span: Span, public value: AST.HeapTyEnum) {}

    equals(other: Type) {
        if (other instanceof HeapTy) {
            return this.value == other.value;
        }
        return false;
    }
}

export class Never {
    constructor(public span: Span) {}

    equals(other: Type) {
        if (other instanceof Never) {
            return true;
        }
        return false;
    }
}

export type Pattern = TypedPattern;

export class UntypedPattern {
    constructor(public span: Span, public mut: boolean, public ident: AST.Ident) {}
}

export class TypedPattern {
    constructor(public span: Span, public pattern: UntypedPattern, public ty: Type) {}
}
