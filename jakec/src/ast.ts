import { Span } from "./lexer";

export class Source {
    constructor(public imports: Import[], public hostImports: HostImport[], public items: Item[]) {}
}

export class Import {
    constructor(
        public span: Span,
        public path: StringLiteral,
        public namespace: Span | null,
        public without: Span[],
        public with_: [Span, Span][]
    ) {}
}

export class HostImport {
    constructor(
        public span: Span,
        public path: StringLiteral,
        public name: Span,
        public ty: Atom | null
    ) {}
}

export type Statement = Let | Return | Assign | Atom | Item;

export class Let {
    constructor(public span: Span, public pattern: Atom | null, public expr: Atom | null) {}
}

export class Return {
    constructor(public span: Span, public expr: Atom | null | undefined) {}
}

export class Assign {
    constructor(
        public span: Span,
        public kind: BinOp,
        public left: Atom | null,
        public right: Atom | null
    ) {}
}

export type Atom =
    | Mut
    | Pure
    | Ascription
    | Binary
    | Unary
    | Call
    | TypeCall
    | Product
    | NumberLiteral
    | IntegerLiteral
    | StringLiteral
    | Ident
    | HeapTy
    | StackTy;

export class Mut {
    constructor(public span: Span, public expr: Atom | null) {}
}

export class Pure {
    constructor(public span: Span, public expr: Atom | null) {}
}

export class Ascription {
    constructor(public span: Span, public expr: Atom | null, public ty: Atom | null) {}
}

export class Binary {
    constructor(
        public span: Span,
        public kind: BinOp,
        public left: Atom | null,
        public right: Atom | null
    ) {}
}

export class Unary {
    constructor(public span: Span, public kind: UnOp, public right: Atom | null) {}
}

export class Call {
    constructor(
        public span: Span,
        public base: Atom | null,
        public ty: Atom[] | null,
        public args: Array<Atom | null>
    ) {}
}

export class TypeCall {
    constructor(public span: Span, public base: Atom | null, public ty: Atom[]) {}
}

export class Product {
    constructor(public span: Span, public fields: Array<Atom | null>) {}
}

export class NumberLiteral {
    constructor(public span: Span, public value: number) {}
}

export class IntegerLiteral {
    constructor(public span: Span, public value: bigint) {}
}

export class StringLiteral {
    constructor(public span: Span, public value: string) {}
}

export class Ident {
    constructor(public span: Span) {}
}

export class HeapTy {
    constructor(public span: Span, public value: HeapTyEnum) {}
}

// prettier-ignore
export enum HeapTyEnum {
    I8  = 0b000000000000000011,
    U8  = 0b000000000000000101,
    I16 = 0b000000000000011111,
    U16 = 0b000000000000101101
}

export class StackTy {
    constructor(public span: Span, public value: StackTyEnum) {}
}

export enum StackTyEnum {
    F32 = 0b000000000111111111,
    I32 = 0b000000011011111111,
    U32 = 0b000000101001101101,
    F64 = 0b000111111111111111,
    I64 = 0b011010111011111111,
    U64 = 0b101000101001101101
}

export class Never {
    constructor(public span: Span) {}
}

export type Item = FunctionDeclaration;

export class FunctionSignature {
    constructor(
        public span: Span,
        public exported: boolean,
        public host: boolean,
        public name: Span,
        public ty: Array<Atom | null> | undefined,
        public params: Array<Atom | null>,
        public returnTy: Atom | null | undefined
    ) {}
}

export class FunctionDeclaration {
    constructor(public span: Span, public sig: FunctionSignature, public body: Statement[]) {}

    get name(): Span {
        return this.sig.name;
    }

    get exported(): boolean {
        return this.sig.exported;
    }
}

export enum UnOp {
    LNot,
    BNot,
    Neg
}

export enum BinOp {
    Id,
    Mul,
    Div,
    Mod,
    Add,
    Sub,
    Shl,
    Shr,
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,
    And,
    Or,
    Xor,
    Arrow
}

export const precedence = new Map([
    [BinOp.Mul, [10, false]],
    [BinOp.Div, [10, false]],
    [BinOp.Mod, [10, false]],
    [BinOp.Add, [9, false]],
    [BinOp.Sub, [9, false]],
    [BinOp.Lt, [8, false]],
    [BinOp.Le, [8, false]],
    [BinOp.Gt, [8, false]],
    [BinOp.Ge, [8, false]],
    [BinOp.Eq, [7, false]],
    [BinOp.Ne, [7, false]],
    [BinOp.And, [6, false]],
    [BinOp.Arrow, [5, true]],
    [BinOp.Or, [4, false]],
    [BinOp.Xor, [3, false]]
]);

function rev<K, V>(x: [K, V][]): [V, K][] {
    return x.map(([k, v]) => [v, k]);
}
const unOps: [string, UnOp][] = [
    ["lnot", UnOp.LNot],
    ["bnot", UnOp.BNot],
    ["neg", UnOp.Neg]
];

export const unOpToName = new Map(rev(unOps));
export const nameToUnOp = new Map(unOps);

const binOps: [string, BinOp][] = [
    ["mul", BinOp.Mul],
    ["div", BinOp.Div],
    ["mod", BinOp.Mod],
    ["add", BinOp.Add],
    ["sub", BinOp.Sub],
    ["lt", BinOp.Lt],
    ["le", BinOp.Le],
    ["gt", BinOp.Gt],
    ["ge", BinOp.Ge],
    ["eq", BinOp.Eq],
    ["ne", BinOp.Ne],
    ["and", BinOp.And],
    ["or", BinOp.Or],
    ["xor", BinOp.Xor]
];

export const binOpToName = new Map(rev(binOps));
export const nameToBinOp = new Map(binOps);
