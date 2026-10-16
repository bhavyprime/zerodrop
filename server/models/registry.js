import DropModel from './Drop.js';

// Services talk to the model through this indirection so tests can substitute an
// in-memory implementation without a running MongoDB.
let impl = DropModel;

export function setDropModel(model) {
  impl = model ?? DropModel;
}

export const Drop = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = impl[prop];
      return typeof value === 'function' ? value.bind(impl) : value;
    },
  },
);
