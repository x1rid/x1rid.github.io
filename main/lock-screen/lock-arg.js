/**
 * @file main/lock-screen/lock-arg.js
 * @description Disabled-by-default, browser-only extension point for fictional
 * accessibility-screen anomalies.
 *
 * HARD BOUNDARY: this module never touches Windows, sethc.exe, host commands,
 * sign-in controls, credentials, permissions, or real security settings. It
 * only emits a namespaced CustomEvent inside this simulator for a later UI
 * layer to interpret. It is deliberately separate from authentication.
 *
 * PUBLIC API (window.LockSecretEvents)
 *   registry                       → Map<id, definition>
 *   setEnabled(id, boolean)        → explicit opt-in (memory only)
 *   isEnabled(id)                  → boolean
 *   canTrigger(id, context)        → Promise<boolean>
 *   trigger(id, context)           → Promise<boolean>
 *   reset()                        → reset simulated event state only
 */

(function (window, document) {
  'use strict';

  const registry = new Map();
  const state = {
    lastTriggeredAt: null,
    triggerCount: 0
  };

  registry.set('accessibility-anomaly', {
    id: 'accessibility-anomaly',
    enabled: false,

    async canTrigger(context) {
      return this.enabled === true &&
        Boolean(context) &&
        context.simulatedEventEligible === true;
    },

    async trigger(context) {
      if (!(await this.canTrigger(context))) return false;

      const detail = {
        source: 'simulated-lock-screen',
        profileId: context.profileId != null ? context.profileId : null,
        simulatedOnly: true,
        emittedAt: Date.now()
      };

      try {
        if (window.SystemServices && window.SystemServices.events &&
            typeof window.SystemServices.events.emit === 'function') {
          window.SystemServices.events.emit('arg:accessibility-anomaly', detail);
        } else {
          document.dispatchEvent(new CustomEvent('arg:accessibility-anomaly', { detail: detail }));
        }
      } catch (error) {
        console.warn('[LockSecretEvents] Could not emit simulated event', error);
        return false;
      }

      state.lastTriggeredAt = detail.emittedAt;
      state.triggerCount += 1;
      return true;
    },

    reset() {
      state.lastTriggeredAt = null;
      state.triggerCount = 0;
    }
  });

  window.LockSecretEvents = {
    registry: registry,

    setEnabled(id, enabled) {
      const definition = registry.get(id);
      if (!definition) return false;
      definition.enabled = Boolean(enabled);
      return true;
    },

    isEnabled(id) {
      const definition = registry.get(id);
      return Boolean(definition && definition.enabled);
    },

    async canTrigger(id, context) {
      const definition = registry.get(id);
      if (!definition) return false;
      return definition.canTrigger(context);
    },

    async trigger(id, context) {
      const definition = registry.get(id);
      if (!definition) return false;
      return definition.trigger(context);
    },

    reset() {
      registry.forEach(function (definition) {
        if (typeof definition.reset === 'function') definition.reset();
      });
      state.lastTriggeredAt = null;
      state.triggerCount = 0;
    },

    diagnostics() {
      const definition = registry.get('accessibility-anomaly');
      return {
        enabled: Boolean(definition && definition.enabled),
        triggerCount: state.triggerCount,
        lastTriggeredAt: state.lastTriggeredAt
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : { dispatchEvent: function () {} });
