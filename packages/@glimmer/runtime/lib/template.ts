import CompilableTemplate from './syntax/compilable-template';
import { Simple, Opaque, Option, BlockSymbolTable } from '@glimmer/interfaces';
import { PathReference } from '@glimmer/reference';
import { assign, EMPTY_ARRAY } from '@glimmer/util';
import {
  SerializedTemplateBlock,
  SerializedTemplateWithLazyBlock,
  TemplateMeta,
  Statement
} from '@glimmer/wire-format';
import { ElementBuilder, NewElementBuilder } from './vm/element-builder';
import { RehydrateBuilder } from './vm/rehydrate-builder';
import { SerializeBuilder } from './vm/serialize-builder';
import { DynamicScope, Environment, CompilationOptions as PublicCompilationOptions } from './environment';
import Scanner from './scanner';
import { BlockSyntax, TopLevelSyntax } from './syntax/interfaces';
import { IteratorResult, RenderResult, VM } from './vm';
import { CompilationOptions } from './internal-interfaces';

export interface RenderOptions {
  env: Environment;
  self: PathReference<Opaque>;
  parentNode: Simple.Element;
  nextSibling?: Option<Simple.Node>;
  dynamicScope: DynamicScope;
  mode?: 'rehydrate' | 'serialize';
}

/**
 * Environment specific template.
 */
export interface Template<T extends TemplateMeta = TemplateMeta> {
  /**
   * Template identifier, if precompiled will be the id of the
   * precompiled template.
   */
  id: string;

  /**
   * Template meta (both compile time and environment specific).
   */
  meta: T;

  hasEval: boolean;

  /**
   * Symbols computed at compile time.
   */
  symbols: string[];

  /**
   * Helper to render template as root entry point.
   */
  render(options: RenderOptions): TemplateIterator;

  // internal casts, these are lazily created and cached
  asEntryPoint(): TopLevelSyntax;
  asLayout(): TopLevelSyntax;
  asPartial(): TopLevelSyntax;
  asBlock(): BlockSyntax;
}

export interface TemplateFactory<T extends TemplateMeta, U> {
  /**
   * Template identifier, if precompiled will be the id of the
   * precompiled template.
   */
  id: string;

  /**
   * Compile time meta.
   */
  meta: T;

  /**
   * Used to create an environment specific singleton instance
   * of the template.
   *
   * @param {Environment} env glimmer Environment
   */
  create(env: PublicCompilationOptions<any, any, any>): Template<T>;
  /**
   * Used to create an environment specific singleton instance
   * of the template.
   *
   * @param {Environment} env glimmer Environment
   * @param {Object} meta environment specific injections into meta
   */
  create(env: PublicCompilationOptions<any, any, any>, meta: U): Template<T & U>;
}

export class TemplateIterator {
  constructor(private vm: VM) {}
  next(): IteratorResult<RenderResult> {
    return this.vm.next();
  }
}

let clientId = 0;

/**
 * Wraps a template js in a template module to change it into a factory
 * that handles lazy parsing the template and to create per env singletons
 * of the template.
 */
export default function templateFactory<T extends TemplateMeta>(serializedTemplate: SerializedTemplateWithLazyBlock<T>): TemplateFactory<T, T>;
export default function templateFactory<T extends TemplateMeta, U>(serializedTemplate: SerializedTemplateWithLazyBlock<T>): TemplateFactory<T, U>;
export default function templateFactory({ id: templateId, meta, block }: SerializedTemplateWithLazyBlock<any>): TemplateFactory<{}, {}> {
  let parsedBlock: SerializedTemplateBlock;
  let id = templateId || `client-${clientId++}`;
  let create = (options: CompilationOptions, envMeta?: {}) => {
    let newMeta = envMeta ? assign({}, envMeta, meta) : meta;
    if (!parsedBlock) {
      parsedBlock = JSON.parse(block);
    }
    return new ScannableTemplate(id, newMeta, options, parsedBlock);
  };
  return { id, meta, create };
}

class ScannableTemplate implements Template<TemplateMeta> {
  private layout: Option<TopLevelSyntax> = null;
  private partial: Option<TopLevelSyntax> = null;
  private block: Option<BlockSyntax> = null;
  private scanner: Scanner;
  public symbols: string[];
  public hasEval: boolean;
  private statements: Statement[];

  constructor(public id: string, public meta: TemplateMeta, private options: CompilationOptions, rawBlock: SerializedTemplateBlock) {
    this.scanner = new Scanner(rawBlock, options);
    this.symbols = rawBlock.symbols;
    this.hasEval = rawBlock.hasEval;
    this.statements = rawBlock.statements;
  }

  render({ env, self, parentNode, dynamicScope, mode }: RenderOptions) {
    let elementBuilder: ElementBuilder;

    switch (mode) {
      case undefined: elementBuilder = NewElementBuilder.forInitialRender(env, parentNode, null); break;
      case 'rehydrate': elementBuilder = RehydrateBuilder.forInitialRender(env, parentNode, null); break;
      case 'serialize': elementBuilder = SerializeBuilder.forInitialRender(env, parentNode, null); break;
      default: throw new Error('unreachable');
    }

    let entryPoint = this.asEntryPoint();
    let handle = entryPoint.compile();
    let vm = VM.initial(this.options.program, env, self, dynamicScope, elementBuilder, entryPoint.symbolTable, handle);
    return new TemplateIterator(vm);
  }

  asEntryPoint(): TopLevelSyntax {
    return this.asLayout();
  }

  asLayout(): TopLevelSyntax {
    if (!this.layout) this.layout = this.scanner.scanLayout(this.compilationMeta());
    return this.layout;
  }

  asPartial(): TopLevelSyntax {
    if (!this.partial) this.partial = this.scanner.scanLayout(this.compilationMeta(true));
    return this.partial;
  }

  asBlock(): BlockSyntax {
    let { options, statements } = this;
    let { block } = this;

    if (!block) {
      let meta = this.compilationMeta();
      block = this.block = new CompilableTemplate<BlockSymbolTable>(statements, { meta, parameters: EMPTY_ARRAY }, options);
    }

    return block!;
  }

  private compilationMeta(asPartial = false) {
    return { templateMeta: this.meta, symbols: this.symbols, asPartial };
  }
}
