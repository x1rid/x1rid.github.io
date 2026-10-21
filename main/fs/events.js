/**
 * @file main/fs/events.js
 * @description Event publisher and subscription manager for VFS file lifecycle events.
 */

(function (window) {
  'use strict';

  /**
   * Simple pub/sub event bus for VFS events.
   */
  class VfsEvents {
    constructor() {
      /** @type {Set<Function>} */
      this.listeners = new Set();
    }

    /**
     * Subscribes a listener callback to filesystem events.
     * @param {function(import('./types.js').FsEvent): void} listener
     * @returns {function(): void} Unsubscribe function
     */
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('VfsEvents.subscribe requires a function');
      }

      this.listeners.add(listener);

      let unsubscribed = false;
      return () => {
        if (!unsubscribed) {
          unsubscribed = true;
          this.listeners.delete(listener);
        }
      };
    }

    /**
     * Broadcasts an event to all subscribed listeners.
     * Guaranteed not to throw if an individual listener throws.
     * @param {import('./types.js').FsEvent} event
     */
    publish(event) {
      if (!event || typeof event !== 'object') {
        return;
      }

      // Snapshot the listeners set to prevent mutation issues during dispatch
      const currentListeners = Array.from(this.listeners);
      for (let i = 0; i < currentListeners.length; i++) {
        const listener = currentListeners[i];
        try {
          listener(event);
        } catch (err) {
          console.error('[VfsEvents] Error in event listener callback:', err, event);
        }
      }
    }

    /**
     * Removes all active listeners.
     */
    clear() {
      this.listeners.clear();
    }
  }

  // Expose to window
  window.VfsEvents = VfsEvents;

})(typeof window !== 'undefined' ? window : globalThis);
