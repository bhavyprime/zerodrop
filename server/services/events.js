import { EventEmitter } from 'node:events';

/**
 * In-process event bus. Lifecycle changes are emitted as
 * { type: 'accessed' | 'downloaded' | 'destroyed', dropId, ... } on the 'drop' channel
 * and forwarded to the sender over WebSocket.
 */
export const dropEvents = new EventEmitter();

export const emitDropEvent = (event) => dropEvents.emit('drop', event);
