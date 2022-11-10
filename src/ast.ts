import { Span } from "./lexer";

export class Source {
    constructor(
        public imports: Import[],
        public hostImports: Import[],
        public items: Item[]
    ) { }
}

export class Import {
    constructor(
        public span: Span,
        public path: StringLiteral,
        public namespace: Span | null,
        public without: Span[],
        public with_: [Span, Span][]
    ) { }
}

export class HostImport {
    constructor(
        public span: Span,
        public path: StringLiteral,
        public name: Span,
        public ty: Atom,
    ) { }
}

export abstract class Statement {
    constructor(
        public span: Span
    ) { }
}

export class Let extends Statement {
    constructor(
        span: Span,
        public pattern: Pattern,
        public expr: Atom
    ) {
        super(span);
    }
}

export class Return extends Statement {
    constructor(
        span: Span,
        public expr: Atom
    ) {
        super(span);
    }
}

export class Assign extends Statement {
    constructor(
        span: Span,
        public left: Atom,
        public right: Atom
    ) {
        super(span);
    }
}

export class AssignOp extends Statement {
    constructor(
        span: Span,
        public kind: BinOp,
        public left: Atom,
        public right: Atom
    ) {
        super(span);
    }
}

export abstract class Atom extends Statement { }

export class AtomArray extends Atom {
    constructor(
        span: Span,
        public atoms: Atom[]
    ) {
        super(span);
    }
}

export class Ascription extends Atom {
    constructor(
        span: Span,
        public expr: Atom,
        public ty: Atom,
    ) {
        super(span);
    }
}

export class Binary extends Atom {
    constructor(
        span: Span,
        public kind: BinOp,
        public left: Atom,
        public right: Atom,
    ) {
        super(span);
    }
}

export class Call extends Atom {
    constructor(
        span: Span,
        public base: Atom,
        public args: Atom[],
    ) {
        super(span);
    }
}

export class Product extends Atom {
    constructor(
        span: Span,
        public fields: Atom[],
    ) {
        super(span);
    }
}

export class NumberLiteral extends Atom {
    constructor(
        span: Span,
        public value: number,
    ) {
        super(span);
    }
}

export class StringLiteral extends Atom {
    constructor(
        span: Span,
        public value: string,
    ) {
        super(span);
    }
}

export class Ident extends Atom {
    constructor(
        span: Span
    ) {
        super(span);
    }
}

export class HeapTy extends Atom {
    constructor(
        span: Span,
        public value: HeapTyEnum,
    ) {
        super(span);
    }
}

export enum HeapTyEnum {
    I8,
    U8,
    I16,
    U16
}

export class StackTy extends Atom {
    constructor(
        span: Span,
        public value: StackTyEnum,
    ) {
        super(span);
    }
}

export enum StackTyEnum {
    I32,
    U32,
    F32,
    I64,
    U64,
    F64
}

export class Never extends Atom {
    constructor(span: Span) {
        super(span);
    }
}

export abstract class Item extends Statement { }

export class FunctionSignature {
    constructor(
        public span: Span,
        public name: string,
        public params: Pattern[]
    ) { }
}

export class FunctionDeclaration extends Item {
    constructor(
        span: Span,
        public sig: FunctionSignature,
        public body: Statement[]
    ) {
        super(span);
    }
}

export abstract class Pattern {
    constructor(
        public span: Span
    ) { }
}

export class Binding extends Pattern {
    constructor(
        span: Span,
        public name: Span,
        public ty: Atom
    ) {
        super(span);
    }
}

export enum UnOp {
    LNot,
    BNot,
    Neg,
}

export enum BinOp {
    Mul,
    Div,
    Mod,
    Add,
    Sub,
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
    [BinOp.Or, [5, false]],
    [BinOp.Xor, [4, false]],
    [BinOp.Arrow, [3, false]],
]);