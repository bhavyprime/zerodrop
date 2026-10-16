// A minimal in-memory stand-in for the Mongoose Drop model, used by the test suite so it can
// run without a MongoDB server. It implements only the calls and operators the services use:
//   findOne, find, create, findOneAndUpdate, updateOne, deleteOne
//   filters: equality, $gt $gte $lt $lte $in $ne, $or
//   updates: $set, $inc
// Unique constraints on dropId, accessCode and storedName are enforced like MongoDB does (code 11000).

const UNIQUE = ['dropId', 'accessCode', 'storedName'];

export class FakeDropModel {
  constructor() {
    this.docs = [];
  }

  reset() {
    this.docs = [];
  }

  #fieldMatches(value, cond) {
    const isOperatorObject =
      cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond);
    if (!isOperatorObject) {
      if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
      return value === cond;
    }
    for (const [op, x] of Object.entries(cond)) {
      switch (op) {
        case '$gt': if (!(value > x)) return false; break;
        case '$gte': if (!(value >= x)) return false; break;
        case '$lt': if (!(value < x)) return false; break;
        case '$lte': if (!(value <= x)) return false; break;
        case '$in': if (!x.includes(value)) return false; break;
        case '$ne': if (value === x) return false; break;
        default: throw new Error(`FakeDropModel: unsupported operator ${op}`);
      }
    }
    return true;
  }

  #matches(doc, filter) {
    return Object.entries(filter).every(([key, cond]) => {
      if (key === '$or') return cond.some((f) => this.#matches(doc, f));
      return this.#fieldMatches(doc[key], cond);
    });
  }

  #apply(doc, update) {
    for (const [op, fields] of Object.entries(update)) {
      if (op === '$set') Object.assign(doc, fields);
      else if (op === '$inc') for (const [k, v] of Object.entries(fields)) doc[k] = (doc[k] ?? 0) + v;
      else throw new Error(`FakeDropModel: unsupported update operator ${op}`);
    }
  }

  async findOne(filter) {
    const doc = this.docs.find((d) => this.#matches(d, filter));
    return doc ? structuredClone(doc) : null;
  }

  async find(filter = {}) {
    return this.docs.filter((d) => this.#matches(d, filter)).map((d) => structuredClone(d));
  }

  async create(data) {
    for (const key of UNIQUE) {
      if (this.docs.some((d) => d[key] === data[key])) {
        throw Object.assign(new Error(`E11000 duplicate key error: ${key}`), {
          code: 11000,
          keyPattern: { [key]: 1 },
        });
      }
    }
    const doc = {
      passwordHash: null,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      currentDownloads: 0,
      status: 'CREATED',
      ...data,
    };
    this.docs.push(doc);
    return structuredClone(doc);
  }

  async findOneAndUpdate(filter, update) {
    // Single-threaded JS makes this match-and-modify step atomic, like MongoDB's.
    const doc = this.docs.find((d) => this.#matches(d, filter));
    if (!doc) return null;
    this.#apply(doc, update);
    return structuredClone(doc);
  }

  async updateOne(filter, update) {
    const doc = this.docs.find((d) => this.#matches(d, filter));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    this.#apply(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(filter) {
    const i = this.docs.findIndex((d) => this.#matches(d, filter));
    if (i === -1) return { deletedCount: 0 };
    this.docs.splice(i, 1);
    return { deletedCount: 1 };
  }
}
