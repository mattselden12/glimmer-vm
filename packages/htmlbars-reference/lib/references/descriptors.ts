import Meta from '../meta';
import { Reference, ChainableReference } from 'htmlbars-reference';
import { InternedString } from 'htmlbars-util';
import PushPullReference from './push-pull';

export interface InnerReferenceFactory {
  new (object: any, property: InternedString): Reference;
}

export class PropertyReference implements Reference {
  private object: any;
  private property: InternedString;

  constructor(object: any, property: InternedString) {
    this.object = object;
    this.property = property;
  }

  isDirty() { return true; }
  value() { return this.object[<string>this.property]; }
  destroy() {}

  label() {
    return '[reference Property]';
  }
}

export function ComputedReferenceBlueprint(property, dependencies) {
  return class ComputedReference extends PushPullReference implements Reference {
    private object: any;
    private property: InternedString;
    private dependencies: InternedString[][];
    private installed = false;

    constructor(object: any, property: InternedString) {
      super();
      this.object = object;
      this.property = property;
      this.dependencies = dependencies;
    }

    value() {
      if (!this.installed) {
        let root = Meta.for(this.object).root();
        this.dependencies.forEach(dep => this._addSource(root.referenceFromParts(dep)));
        this.installed = true;
      }

      return this.object[<string>this.property];
    }

    label() {
      return '[reference Computed]';
    }
  };
}