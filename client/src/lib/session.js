// sessionStorage keeps the sender's code and token for this tab only; closing the tab forgets them.
const read = (key) => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the page still works until it is reloaded */
  }
};
const remove = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

export const sentDrop = {
  get: (id) => read(`sent:${id}`),
  set: (id, value) => write(`sent:${id}`, value),
  clear: (id) => remove(`sent:${id}`),
};

export const receivedDrop = {
  get: (id) => read(`received:${id}`),
  set: (id, value) => write(`received:${id}`, value),
  clear: (id) => remove(`received:${id}`),
};
