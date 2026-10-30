/**
 * @file main/security/permissions.js
 * @layer L2 — Security
 * @owns  window.SecurityPermissions
 * @needs [ 'SecurityUsers', 'SecurityAudit' ]
 * @emits [ 'sec:audit' ]
 *
 * Spec reference: OS_FOUNDATION.md §3 (L2 Security), §5.3 (Syscall permission engine), §6.1
 *
 * Deterministic default-deny permission evaluator.
 * Evaluates actor capabilities, roles, user/group rules against actions and resources.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';

  // Code-level baseline rules extracted from SystemConfig simulation defaults
  const DEFAULT_RULES = Object.freeze([
    {
      id: 'rule-system-files',
      name: 'Protect system files',
      effect: 'deny',
      actions: ['fs:write', 'fs:delete', 'fs:rename'],
      resource: 'C:\\Windows\\**',
      description: 'Deny modification of Windows directory contents',
      system: true
    },
    {
      id: 'rule-admin-full',
      name: 'Administrator full access',
      effect: 'allow',
      actions: ['*'],
      resource: '*',
      roles: ['administrator', 'system'],
      system: true
    },
    {
      id: 'rule-user-home',
      name: 'User home directory access',
      effect: 'allow',
      actions: ['fs:read', 'fs:write', 'fs:delete', 'fs:rename', 'fs:create'],
      resource: 'C:\\Users\\**',
      roles: ['administrator', 'user', 'guest'],
      system: true
    },
    {
      id: 'rule-app-exec',
      name: 'Execute applications',
      effect: 'allow',
      actions: ['app:launch', 'proc:spawn'],
      resource: '*',
      roles: ['administrator', 'user', 'guest'],
      system: true
    }
  ]);

  function normalize(str) {
    return String(str || '').trim().toLowerCase();
  }

  function matchesAction(ruleActions, targetAction) {
    if (!ruleActions) return false;
    const act = normalize(targetAction);
    const list = Array.isArray(ruleActions) ? ruleActions : [ruleActions];
    for (let i = 0; i < list.length; i += 1) {
      const rAct = normalize(list[i]);
      if (rAct === '*' || rAct === act) return true;
    }
    return false;
  }

  function matchesResource(ruleResource, targetResource) {
    if (!ruleResource) return false;
    const rRes = normalize(ruleResource);
    const tRes = normalize(targetResource);
    if (rRes === '*' || rRes === tRes) return true;
    if (rRes.endsWith('\\**')) {
      const prefix = rRes.slice(0, -3);
      return tRes.startsWith(prefix);
    }
    if (rRes.endsWith('/**')) {
      const prefix = rRes.slice(0, -3);
      return tRes.startsWith(prefix);
    }
    return false;
  }

  function check(request, customRules, customUsers) {
    if (!request || typeof request !== 'object') {
      return { allowed: false, reason: 'invalid-request', ruleId: null };
    }

    const action = request.action || request.op || '*';
    const resource = request.resource || request.path || '*';
    const usersMod = root.SecurityUsers;
    const auditMod = root.SecurityAudit;

    // Resolve actor / principal
    let user = null;
    if (request.user && typeof request.user === 'object') {
      user = request.user;
    } else if (typeof request.user === 'string' && usersMod) {
      user = usersMod.getUser(request.user, customUsers);
    } else if (usersMod) {
      user = usersMod.getCurrentUser(request.profileId, customUsers);
    }

    const role = (user && user.role) ? normalize(user.role) : 'guest';
    const groups = (user && Array.isArray(user.groups)) ? user.groups.map(normalize) : [];
    const userId = (user && user.id) ? normalize(user.id) : 'guest';

    const rules = Array.isArray(customRules) ? customRules : DEFAULT_RULES;

    // First check explicit deny rules (deny overrides allow)
    for (let i = 0; i < rules.length; i += 1) {
      const r = rules[i];
      if (r.effect === 'deny' && matchesAction(r.actions, action) && matchesResource(r.resource, resource)) {
        // If rule specifies users/roles/groups, check applicability
        let applies = true;
        if (Array.isArray(r.roles) && r.roles.length > 0 && !r.roles.map(normalize).includes(role)) applies = false;
        if (Array.isArray(r.users) && r.users.length > 0 && !r.users.map(normalize).includes(userId)) applies = false;
        if (applies) {
          const res = { allowed: false, reason: 'rule-deny', ruleId: r.id };
          if (auditMod && request.audit !== false) {
            auditMod.record({ action: action, resource: resource, actor: user, result: 'deny', reason: r.id });
          }
          return res;
        }
      }
    }

    // Next check explicit allow rules
    for (let i = 0; i < rules.length; i += 1) {
      const r = rules[i];
      if (r.effect === 'allow' && matchesAction(r.actions, action) && matchesResource(r.resource, resource)) {
        let applies = false;
        if (!r.roles && !r.users && !r.groups) {
          applies = true;
        } else {
          if (Array.isArray(r.roles) && r.roles.map(normalize).includes(role)) applies = true;
          if (Array.isArray(r.users) && r.users.map(normalize).includes(userId)) applies = true;
          if (Array.isArray(r.groups) && r.groups.some(function (g) { return groups.includes(normalize(g)); })) applies = true;
        }
        if (applies) {
          const res = { allowed: true, reason: 'rule-allow', ruleId: r.id };
          if (auditMod && request.audit !== false) {
            auditMod.record({ action: action, resource: resource, actor: user, result: 'allow', reason: r.id });
          }
          return res;
        }
      }
    }

    // Default-deny if no allow rule matched
    const defaultDeny = { allowed: false, reason: 'default-deny', ruleId: null };
    if (auditMod && request.audit !== false) {
      auditMod.record({ action: action, resource: resource, actor: user, result: 'deny', reason: 'default-deny' });
    }
    return defaultDeny;
  }

  function can(action, resource, options) {
    const req = Object.assign({}, options, { action: action, resource: resource });
    return check(req).allowed;
  }

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  const SecurityPermissions = Object.freeze({
    version: VERSION,
    ready: ready,

    check: check,
    can: can,
    getDefaultRules: function () { return JSON.parse(JSON.stringify(DEFAULT_RULES)); },

    diagnostics: function () {
      return {
        version: VERSION,
        defaultRulesCount: DEFAULT_RULES.length
      };
    }
  });

  root.SecurityPermissions = SecurityPermissions;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SecurityPermissions: SecurityPermissions };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
