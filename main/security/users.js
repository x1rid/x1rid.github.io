/**
 * @file main/security/users.js
 * @layer L2 — Security
 * @owns  window.SecurityUsers
 * @needs []
 * @emits []
 *
 * Spec reference: OS_FOUNDATION.md §3 (L2 Security), §5.1, §6.1
 *
 * Principals, virtual user identities, and groups for permission evaluation.
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';

  // Standard simulation groups & users extracted from SystemConfig defaults
  const DEFAULT_GROUPS = Object.freeze([
    { id: 'administrators', name: 'Administrators', description: 'Full system control', system: true },
    { id: 'users', name: 'Users', description: 'Standard simulator users', system: true },
    { id: 'guests', name: 'Guests', description: 'Ephemeral and guest sessions', system: true }
  ]);

  const DEFAULT_USERS = Object.freeze([
    { id: 'owner', name: 'Operator', role: 'administrator', groups: ['administrators', 'users'], active: true },
    { id: 'guest', name: 'Guest', role: 'guest', groups: ['guests'], active: true },
    { id: 'system', name: 'SYSTEM', role: 'system', groups: ['administrators'], active: true }
  ]);

  function clone(val) {
    return JSON.parse(JSON.stringify(val));
  }

  function getUser(id, customUsers) {
    const list = Array.isArray(customUsers) ? customUsers : DEFAULT_USERS;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return clone(list[i]);
    }
    return null;
  }

  function getGroup(id, customGroups) {
    const list = Array.isArray(customGroups) ? customGroups : DEFAULT_GROUPS;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return clone(list[i]);
    }
    return null;
  }

  function getCurrentUser(profileId, customUsers) {
    const target = profileId || (root.ProfileService && typeof root.ProfileService.getActiveId === 'function' ? root.ProfileService.getActiveId() : 'owner');
    return getUser(target, customUsers) || getUser('guest', customUsers) || DEFAULT_USERS[1];
  }

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  const SecurityUsers = Object.freeze({
    version: VERSION,
    ready: ready,

    getUser: getUser,
    getGroup: getGroup,
    getCurrentUser: getCurrentUser,
    listUsers: function (custom) { return clone(Array.isArray(custom) ? custom : DEFAULT_USERS); },
    listGroups: function (custom) { return clone(Array.isArray(custom) ? custom : DEFAULT_GROUPS); },

    diagnostics: function () {
      return {
        version: VERSION,
        defaultUsersCount: DEFAULT_USERS.length,
        defaultGroupsCount: DEFAULT_GROUPS.length
      };
    }
  });

  root.SecurityUsers = SecurityUsers;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SecurityUsers: SecurityUsers };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
